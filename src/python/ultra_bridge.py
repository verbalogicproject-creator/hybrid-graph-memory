import argparse
import hashlib
import heapq
import importlib
import json
import os
import sqlite3
import sys
import time
import uuid


DEFAULT_MODEL_PATH = "/root/models/ultra-50g"
PINNED_MODEL_VERSION = "d46107d8415549e7c7386d26903ad11c9a8de4fd"
PINNED_MODEL_SHA256 = "7db88a9d36e9d4a65af087d6e9ebd5cdd953a47ff2c3989eb1ad9ce262571a8f"


class UltraUnavailableError(RuntimeError):
    pass


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model_artifact(model_path, expected_checksum):
    checksum = expected_checksum.lower()
    if len(checksum) != 64 or any(ch not in "0123456789abcdef" for ch in checksum):
        raise ValueError("--model-checksum must be a verified SHA-256")
    weights_path = os.path.join(model_path, "model.safetensors")
    if not os.path.isfile(weights_path):
        raise FileNotFoundError(f"ULTRA weights not found: {weights_path}")
    actual_checksum = sha256_file(weights_path)
    if actual_checksum != checksum:
        raise ValueError(
            f"ULTRA checksum mismatch: expected {checksum}, got {actual_checksum}"
        )
    return actual_checksum


def load_ultra_runtime(model_path, importer=importlib.import_module):
    if model_path not in sys.path:
        sys.path.insert(0, model_path)
    try:
        torch = importer("torch")
        pyg_data = importer("torch_geometric.data")
        modeling = importer("modeling")
        tasks = importer("ultra.tasks")
    except (ImportError, ModuleNotFoundError) as error:
        missing = getattr(error, "name", None) or str(error)
        raise UltraUnavailableError(
            f"ULTRA dependency unavailable ({missing}). Use the dedicated ULTRA virtual environment."
        ) from error

    model_class = getattr(modeling, "UltraForKnowledgeGraphReasoning", None)
    if model_class is None or not hasattr(model_class, "from_pretrained"):
        raise UltraUnavailableError(
            "Downloaded model wrapper does not expose UltraForKnowledgeGraphReasoning.from_pretrained"
        )
    build_relation_graph = getattr(tasks, "build_relation_graph", None)
    if not callable(build_relation_graph):
        raise UltraUnavailableError("ULTRA tasks module does not expose build_relation_graph")
    data_class = getattr(pyg_data, "Data", None)
    if data_class is None:
        raise UltraUnavailableError("torch_geometric.data does not expose Data")
    return {
        "torch": torch,
        "Data": data_class,
        "model_class": model_class,
        "build_relation_graph": build_relation_graph,
    }


def load_networkx(importer=importlib.import_module):
    try:
        return importer("networkx")
    except (ImportError, ModuleNotFoundError) as error:
        raise UltraUnavailableError(
            "networkx is required for System 2 community detection"
        ) from error


def load_graph(db_path):
    print(f"[System 2] Connecting to Memory OS database: {db_path}")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("""
        SELECT from_id, relation, to_id
        FROM relations
        WHERE origin IN ('declared', 'observed_ast')
          AND admission_status = 'admitted'
    """)
    rows = cur.fetchall()

    entity2id = {}
    id2entity = {}
    relation2id = {}
    edges_src = []
    edges_dst = []
    edge_types = []

    for from_id, relation, to_id in rows:
        if from_id not in entity2id:
            idx = len(entity2id)
            entity2id[from_id] = idx
            id2entity[idx] = from_id
        if to_id not in entity2id:
            idx = len(entity2id)
            entity2id[to_id] = idx
            id2entity[idx] = to_id
        if relation not in relation2id:
            relation2id[relation] = len(relation2id)
        edges_src.append(entity2id[from_id])
        edges_dst.append(entity2id[to_id])
        edge_types.append(relation2id[relation])

    print(f"[System 2] Graph loaded: {len(entity2id)} nodes, {len(rows)} edges.")
    return conn, entity2id, id2entity, relation2id, edges_src, edges_dst, edge_types


def compute_louvain_communities(id2entity, edges_src, edges_dst, nx=None):
    nx = nx or load_networkx()
    print("[System 2] Computing Louvain communities for multi-agent routing...")
    graph = nx.Graph()
    graph.add_nodes_from(id2entity.keys())
    graph.add_edges_from(zip(edges_src, edges_dst))
    communities = nx.algorithms.community.louvain_communities(graph, seed=0)
    community_map = {}
    for index, community in enumerate(communities):
        community_map[f"community_{index}"] = sorted(id2entity[node] for node in community)
    print(f"[System 2] Graph partitioned into {len(communities)} candidate communities.")
    return community_map


def write_communities(db_path, community_map):
    db_dir = os.path.dirname(db_path)
    community_file = os.path.join(db_dir, "multi_agent_communities.json")
    community_tmp = community_file + ".tmp"
    with open(community_tmp, "w", encoding="utf8") as handle:
        json.dump(community_map, handle, indent=2, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(community_tmp, community_file)
    print(f"[System 2] Multi-agent routing map saved to {community_file}")


def run_link_prediction(
    entity2id,
    id2entity,
    relation2id,
    src,
    dst,
    etypes,
    model_path,
    runtime=None,
    confidence_threshold=0.85,
    head_batch_size=4,
    tail_batch_size=256,
    max_predictions=1000,
):
    runtime = runtime or load_ultra_runtime(model_path)
    torch = runtime["torch"]
    data_class = runtime["Data"]
    build_relation_graph = runtime["build_relation_graph"]
    model_class = runtime["model_class"]

    num_nodes = len(entity2id)
    num_direct_relations = len(relation2id)
    if num_nodes == 0 or num_direct_relations == 0:
        return []

    print("[System 2] Running ULTRA zero-shot link prediction via PyG...")
    model = model_class.from_pretrained(model_path, local_files_only=True)
    model.eval()
    device = torch.device("cpu")
    model.to(device)

    direct_edge_index = torch.tensor([src, dst], dtype=torch.long, device=device)
    direct_edge_type = torch.tensor(etypes, dtype=torch.long, device=device)
    edge_index = torch.cat([direct_edge_index, direct_edge_index.flip(0)], dim=1)
    edge_type = torch.cat(
        [direct_edge_type, direct_edge_type + num_direct_relations], dim=0
    )
    graph_data = data_class(
        edge_index=edge_index,
        edge_type=edge_type,
        num_nodes=num_nodes,
        num_relations=num_direct_relations * 2,
    )
    graph_data = build_relation_graph(graph_data).to(device)

    id2relation = {index: relation for relation, index in relation2id.items()}
    known_edges = set(zip(src, etypes, dst))
    best_predictions = []

    with torch.no_grad():
        for relation_index in range(num_direct_relations):
            relation_name = id2relation[relation_index]
            for head_start in range(0, num_nodes, head_batch_size):
                head_end = min(head_start + head_batch_size, num_nodes)
                for tail_start in range(0, num_nodes, tail_batch_size):
                    tail_end = min(tail_start + tail_batch_size, num_nodes)
                    heads = torch.arange(head_start, head_end, device=device)
                    tails = torch.arange(tail_start, tail_end, device=device)
                    head_grid, tail_grid = torch.meshgrid(heads, tails, indexing="ij")
                    relation_grid = torch.full_like(head_grid, relation_index)
                    query_batch = torch.stack(
                        [head_grid, tail_grid, relation_grid], dim=-1
                    )
                    scores = model(graph_data, query_batch)
                    confidences = torch.sigmoid(scores)
                    matches = torch.nonzero(
                        confidences > confidence_threshold, as_tuple=False
                    ).tolist()

                    for local_head, local_tail in matches:
                        head_index = head_start + local_head
                        tail_index = tail_start + local_tail
                        if head_index == tail_index:
                            continue
                        if (head_index, relation_index, tail_index) in known_edges:
                            continue
                        candidate = (
                            float(confidences[local_head, local_tail]),
                            id2entity[head_index],
                            relation_name,
                            id2entity[tail_index],
                        )
                        if len(best_predictions) < max_predictions:
                            heapq.heappush(best_predictions, candidate)
                        elif candidate > best_predictions[0]:
                            heapq.heapreplace(best_predictions, candidate)

    ordered = sorted(
        best_predictions,
        key=lambda item: (-item[0], item[1], item[2], item[3]),
    )
    return [
        (head, f"{relation}_inferred", tail, confidence)
        for confidence, head, relation, tail in ordered
    ]


def store_predictions(
    conn,
    predictions,
    workspace,
    project,
    model_name,
    model_version,
    model_checksum,
    confidence_threshold,
):
    if not predictions:
        print("[System 2] No candidate relations crossed the configured threshold.")
        return
    print(
        f"[System 2] Found {len(predictions)} candidate edges. "
        "Writing review-gated provenance records..."
    )
    cur = conn.cursor()
    try:
        cur.execute("BEGIN IMMEDIATE")
        for head, relation, tail, confidence in predictions:
            timestamp = int(time.time() * 1000)
            metadata = json.dumps(
                {
                    "threshold": confidence_threshold,
                    "reviewRequired": True,
                    "scoreSemantics": "sigmoid_transformed_model_logit",
                },
                sort_keys=True,
            )
            cur.execute("""
                INSERT INTO relations
                (id, from_id, relation, to_id, source, weight, confidence, metadata,
                 workspace, project, module, origin, admission_status,
                 model_name, model_version, model_checksum, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                str(uuid.uuid4()), head, relation, tail, "ultra_link_prediction",
                1.0, confidence, metadata, workspace, project, "root",
                "model_inferred", "candidate", model_name, model_version,
                model_checksum, timestamp,
            ))
        conn.commit()
        print(
            "[System 2] Candidate relations recorded; they remain excluded "
            "until independent admission."
        )
    except Exception:
        conn.rollback()
        raise


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="ULTRA System 2 worker")
    parser.add_argument("--db", help="Path to the memory SQLite database")
    parser.add_argument("--check", action="store_true", help="Verify the local ULTRA runtime without opening a database")
    parser.add_argument("--model-path", default=DEFAULT_MODEL_PATH)
    parser.add_argument("--model-name", default="ULTRA-50G")
    parser.add_argument("--model-version", default=PINNED_MODEL_VERSION)
    parser.add_argument("--model-checksum", default=PINNED_MODEL_SHA256)
    parser.add_argument("--workspace", default="default")
    parser.add_argument("--project", default="default")
    parser.add_argument("--confidence-threshold", type=float, default=0.85)
    parser.add_argument("--head-batch-size", type=int, default=4)
    parser.add_argument("--tail-batch-size", type=int, default=256)
    parser.add_argument("--max-predictions", type=int, default=1000)
    args = parser.parse_args(argv)
    if not args.check and not args.db:
        parser.error("--db is required unless --check is used")
    if not 0 < args.confidence_threshold < 1:
        parser.error("--confidence-threshold must be between 0 and 1")
    if not 1 <= args.head_batch_size <= 64:
        parser.error("--head-batch-size must be between 1 and 64")
    if not 1 <= args.tail_batch_size <= 4096:
        parser.error("--tail-batch-size must be between 1 and 4096")
    if not 1 <= args.max_predictions <= 100000:
        parser.error("--max-predictions must be between 1 and 100000")
    return args


def main(argv=None):
    args = parse_args(argv)
    try:
        model_checksum = verify_model_artifact(args.model_path, args.model_checksum)
        runtime = load_ultra_runtime(args.model_path)
        nx = load_networkx()
        if args.check:
            print(
                f"[System 2] ULTRA runtime ready: model={args.model_name} "
                f"version={args.model_version} sha256={model_checksum}"
            )
            return 0

        conn, entity2id, id2entity, relation2id, src, dst, etypes = load_graph(args.db)
        try:
            if not entity2id:
                print("[System 2] Graph is empty. Exiting.")
                return 0
            communities = compute_louvain_communities(id2entity, src, dst, nx=nx)
            predictions = run_link_prediction(
                entity2id,
                id2entity,
                relation2id,
                src,
                dst,
                etypes,
                args.model_path,
                runtime=runtime,
                confidence_threshold=args.confidence_threshold,
                head_batch_size=args.head_batch_size,
                tail_batch_size=args.tail_batch_size,
                max_predictions=args.max_predictions,
            )
            write_communities(args.db, communities)
            store_predictions(
                conn,
                predictions,
                args.workspace,
                args.project,
                args.model_name,
                args.model_version,
                model_checksum,
                args.confidence_threshold,
            )
            return 0
        finally:
            conn.close()
    except Exception as error:
        print(f"[System 2] Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
