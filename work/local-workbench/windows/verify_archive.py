"""Verify a Windows ZIP and run its bundled server using an unoccupied local port."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verify_service import check_server
from package_windows import LAUNCHER, NAME, NODE_SHA256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--check-feed", action="store_true")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="Trend Workbench Windows ") as tmp:
        with zipfile.ZipFile(args.archive) as archive:
            assert archive.testzip() is None
            for member in archive.namelist():
                parts = Path(member).parts
                assert parts[0] == NAME and not set(parts).intersection({"..", ".git", "logs", "node_modules"})
            archive.extractall(tmp)
        package = Path(tmp) / NAME
        node = package / "runtime/node.exe"
        with node.open("rb") as stream:
            assert hashlib.file_digest(stream, "sha256").hexdigest() == NODE_SHA256
        assert (package / LAUNCHER).is_file()
        version = subprocess.check_output([node, "-p", "process.platform+' '+process.arch+' '+process.version"], text=True)
        assert version.strip() == "win32 x64 v24.14.1"
        subprocess.run(["powershell.exe", "-NoProfile", "-File", str(package / "launcher.ps1"), "-CheckOnly", "-NoWindow"], check=True)
        check_server(package, str(node), args.check_feed)
    print("Windows runtime, launch paths, relocated application and session shutdown verified.")


if __name__ == "__main__":
    main()
