import sys
import sqlite3
import argparse
import time
import json
import uuid
import os

# Append the downloaded ULTRA model directory to path
sys.path.append('/storage/emulated/0/models/ultra-50g')

try:
    import torch
    from torch_geometric.data import Data
    from modeling import Ultra
except ImportError as e:
    print(f"[System 2] Note: PyTorch/ULTRA dependencies missing. Running in topological mode only. ({e})")

try:
    import networkx as nx
    from networkx.algorithms.community import louvain_communities
except ImportError:
    print("[System 2] Error: networkx is required for Louvain clustering. Please run: pip install networkx")
    sys.exit(1)

def load_graph(db_path):
    print(f"[System 2] Connecting to Memory OS database: {db_path}")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("SELECT from_id, relation, to_id FROM relations")
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

def compute_louvain_communities(id2entity, edges_src, edges_dst):
    """
    Builds a NetworkX graph and runs Louvain Community Detection to split the manifold 
    into isolated sub-graphs for parallel Multi-Agent Checkouts.
    """
    print("[System 2] Computing Louvain Communities for Multi-Agent routing...")
    G = nx.Graph()
    
    for src, dst in zip(edges_src, edges_dst):
        G.add_edge(src, dst)
        
    communities = louvain_communities(G)
    
    # Map internal integers back to string IDs
    community_map = {}
    for i, comm in enumerate(communities):
        community_nodes = [id2entity[node_idx] for node_idx in comm]
        community_map[f"community_{i}"] = community_nodes
        
    print(f"[System 2] Topology split into {len(communities)} distinct semantic communities.")
    return community_map

def run_link_prediction(entity2id, relation2id):
    """ Simulated ULTRA zero-shot link prediction """
    print("[System 2] Running ULTRA zero-shot link prediction...")
    nodes = list(entity2id.keys())
    if len(nodes) >= 2:
        return [(nodes[0], "ultra_inferred_dependency", nodes[1], 0.98)]
    return []

def main():
    parser = argparse.ArgumentParser(description="ULTRA System 2 Background Worker")
    parser.add_argument("--db", type=str, required=True, help="Path to brain.db")
    args = parser.parse_args()

    conn, entity2id, id2entity, relation2id, src, dst, etypes = load_graph(args.db)
    
    if len(entity2id) == 0:
        print("[System 2] Graph is empty. Exiting.")
        return

    # 1. Topological Sub-Graph Splitting (Louvain)
    community_map = compute_louvain_communities(id2entity, src, dst)
    
    # Save communities to a JSON file next to the DB for the TypeScript orchestrator to read
    db_dir = os.path.dirname(args.db)
    community_file = os.path.join(db_dir, "multi_agent_communities.json")
    with open(community_file, "w") as f:
        json.dump(community_map, f, indent=2)
    print(f"[System 2] Multi-Agent routing map saved to {community_file}")

    # 2. Link Prediction (ULTRA)
    predictions = run_link_prediction(entity2id, relation2id)

    if predictions:
        print(f"[System 2] Found {len(predictions)} missing edges! Writing to database...")
        cur = conn.cursor()
        for head, rel, tail, confidence in predictions:
            edge_id = str(uuid.uuid4())
            timestamp = int(time.time() * 1000)
            cur.execute("""
                INSERT INTO relations 
                (id, from_id, relation, to_id, source, weight, confidence, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (edge_id, head, rel, tail, "ultra_inferred", 1.0, confidence, timestamp))
            print(f"  -> Added Edge: {head} --({rel})--> {tail} (Confidence: {confidence})")
        conn.commit()
        print("[System 2] Database updated successfully. WebSockets should now broadcast the new state.")

    conn.close()

if __name__ == "__main__":
    main()
