import hashlib
import importlib.util
import tempfile
import types
import unittest
import sys

sys.dont_write_bytecode = True
from pathlib import Path


BRIDGE_PATH = Path(__file__).resolve().parents[1] / "src" / "python" / "ultra_bridge.py"
spec = importlib.util.spec_from_file_location("ultra_bridge_under_test", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class FakeWrapper:
    @classmethod
    def from_pretrained(cls, *args, **kwargs):
        return cls()


class UltraBridgeContract(unittest.TestCase):
    def test_checksum_is_verified_against_model_bytes(self):
        with tempfile.TemporaryDirectory(prefix="ultra-checksum-") as temp_dir:
            model_path = Path(temp_dir)
            weights = b"pinned-test-weights"
            (model_path / "model.safetensors").write_bytes(weights)
            checksum = hashlib.sha256(weights).hexdigest()
            self.assertEqual(bridge.verify_model_artifact(str(model_path), checksum), checksum)
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                bridge.verify_model_artifact(str(model_path), "0" * 64)

    def test_runtime_uses_huggingface_wrapper_not_raw_ultra_class(self):
        modules = {
            "torch": types.SimpleNamespace(),
            "torch_geometric.data": types.SimpleNamespace(Data=object),
            "modeling": types.SimpleNamespace(
                Ultra=object,
                UltraForKnowledgeGraphReasoning=FakeWrapper,
            ),
            "ultra.tasks": types.SimpleNamespace(build_relation_graph=lambda data: data),
        }
        runtime = bridge.load_ultra_runtime("/tmp/fake-ultra", importer=modules.__getitem__)
        self.assertIs(runtime["model_class"], FakeWrapper)

    def test_old_raw_model_api_is_rejected(self):
        modules = {
            "torch": types.SimpleNamespace(),
            "torch_geometric.data": types.SimpleNamespace(Data=object),
            "modeling": types.SimpleNamespace(Ultra=object),
            "ultra.tasks": types.SimpleNamespace(build_relation_graph=lambda data: data),
        }
        with self.assertRaisesRegex(bridge.UltraUnavailableError, "UltraForKnowledgeGraphReasoning"):
            bridge.load_ultra_runtime("/tmp/fake-ultra", importer=modules.__getitem__)


if __name__ == "__main__":
    unittest.main()
