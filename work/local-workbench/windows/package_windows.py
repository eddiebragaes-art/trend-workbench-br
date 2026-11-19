"""Modificado para trend-workbench-br: nomes e instruções em português.

Build a relocatable Windows x64 package from the shared desktop source."""
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
NAME = "Estacao de Tendencias"
LAUNCHER = "Iniciar Estacao de Tendencias.vbs"
NODE_SHA256 = "58e74bf02fc5bbacc41dcb8bef089961cd5bddd37830b87784e4fc624d145d1f"
README = """Estação de Tendências (trend-workbench-br) · Windows x64

1. Extraia a pasta inteira do ZIP para um local onde você possa gravar (por exemplo, Documentos).
2. Dê dois cliques em "Iniciar Estacao de Tendencias.vbs".
3. A estação abre numa janela própria do Microsoft Edge. O Node já vem incluído.

As cotações ao vivo precisam de internet. Ao fechar a janela, o serviço local encerra sozinho.
Se precisar encerrar o serviço manualmente, clique com o botão direito em
"Parar servico local.ps1" e escolha "Executar com o PowerShell".

Baseado no projeto original Trend Workbench: https://github.com/nhovongoc0-max/trend-workbench
Desenvolvedor original (DeFi狙击手)  https://x.com/bi_9527zx
Comunidade original  https://t.me/jujishou9527
Versão modificada: https://github.com/eddiebragaes-art/trend-workbench-br
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    runtime = args.node_dir / "node.exe"
    with runtime.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != NODE_SHA256:
            raise ValueError("Unexpected Node binary, use fetch_runtime.py win-x64")
    with tempfile.TemporaryDirectory(prefix="Trend-Workbench-Windows-") as tmp:
        root = Path(tmp) / NAME
        subprocess.run(["node", str(HERE.parent / "build.mjs"), "--shared-assets", str(root)], check=True)
        for file in ("launcher.ps1", LAUNCHER, "Parar servico local.ps1"):
            shutil.copyfile(HERE / file, root / file)
        (root / "runtime").mkdir()
        shutil.copyfile(runtime, root / "runtime/node.exe")
        shutil.copyfile(HERE.parent / "assets/workbench.ico", root / "Estacao de Tendencias.ico")
        (root / "LEIA-ME.txt").write_text(README, encoding="utf-8-sig")
        licenses = root / "Licenses"
        licenses.mkdir()
        for document in ("LICENSE", "NOTICE"):
            shutil.copyfile(HERE.parents[2] / document, root / document)
        shutil.copyfile(args.node_dir / "LICENSE", licenses / "Node.txt")
        for package in ("react", "react-dom", "scheduler", "lucide-react", "tailwindcss"):
            shutil.copyfile(HERE.parent.parent / "chan-market/node_modules" / package / "LICENSE", licenses / (package + ".txt"))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=args.output.parent, delete=False, suffix=".pending") as file:
            pending = Path(file.name)
        try:
            with zipfile.ZipFile(pending, "w", zipfile.ZIP_DEFLATED) as bundle:
                for entry in sorted(root.rglob("*")):
                    if entry.is_file():
                        bundle.write(entry, entry.relative_to(root.parent))
            with zipfile.ZipFile(pending) as bundle:
                if bundle.testzip():
                    raise ValueError("ZIP integrity check failed")
            pending.replace(args.output)
        finally:
            pending.unlink(missing_ok=True)
    print(args.output.resolve())


if __name__ == "__main__":
    main()
