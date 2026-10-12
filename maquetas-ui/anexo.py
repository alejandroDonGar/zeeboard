# Regenera la sección «Anexo» de REDISENO.md con el código actual de todas las maquetas.
# Uso: python maquetas-ui/anexo.py
from pathlib import Path

here = Path(__file__).parent
readme = here.parent / "REDISENO.md"
mark = "## 11. Anexo: código completo de las maquetas"
lang = {".css": "css", ".js": "js", ".html": "html", ".py": "python"}

order = ["base.css", "shell.js", "ambient.js", "art.js", "chart.js"]
files = order + sorted(p.name for p in here.glob("*.html"))

parts = [mark, "", "Generado con `python maquetas-ui/anexo.py`; no editar a mano.", ""]
for name in files:
    code = (here / name).read_text(encoding="utf-8").rstrip()
    parts += [f"### `maquetas-ui/{name}`", "", f"````{lang[Path(name).suffix]}", code, "````", ""]

text = readme.read_text(encoding="utf-8")
text = text.split(mark)[0].rstrip().removesuffix("---").rstrip() + "\n\n---\n\n" + "\n".join(parts)
readme.write_text(text, encoding="utf-8")
print(f"Anexo con {len(files)} archivos")
