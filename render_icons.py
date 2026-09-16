import subprocess
import os
from PIL import Image

dumbbell_svg = """<svg xmlns="http://www.w3.org/2000/svg" width="132" height="132" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14.4 14.4 9.6 9.6"/>
  <path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l.707-.707a2 2 0 1 1 2.829 2.828l-.707.707Z"/>
  <path d="m21.5 21.5-1.4-1.4"/>
  <path d="M3.9 7.1a2 2 0 1 1 2.8-2.8l.7.7a2 2 0 1 1-2.8 2.8l-.7-.7Z"/>
  <path d="m3.9 3.9 1.4 1.4"/>
  <path d="m14.4 9.6 4.3-4.3a2 2 0 0 0 0-2.8l-.1-.1a2 2 0 0 0-2.8 0L11.5 6.7"/>
  <path d="m9.6 14.4-4.3 4.3a2 2 0 0 0 0 2.8l.1.1a2 2 0 0 0 2.8 0l4.3-4.3"/>
</svg>"""

cloud_svg = """<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#09090A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
  <path d="M12 12v9"/>
  <path d="m8 17 4 4 4-4"/>
</svg>"""

def render_svg_to_png(svg_content, width, height, output_png):
    html_content = f"""<!DOCTYPE html>
<html>
<head><style>
html, body {{ margin: 0; padding: 0; background: transparent; overflow: hidden; width: {width}px; height: {height}px; }}
svg {{ display: block; }}
</style></head>
<body>
{svg_content}
</body>
</html>"""
    temp_html = os.path.abspath(f"_temp_{width}.html")
    temp_png = os.path.abspath(f"_temp_{width}.png")
    with open(temp_html, "w", encoding="utf-8") as f:
        f.write(html_content)
    
    edge = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    subprocess.run([
        edge,
        "--headless",
        "--default-background-color=00000000",
        f"--screenshot={temp_png}",
        f"--window-size={width},{height}",
        f"file:///{temp_html}"
    ], check=True)
    
    img = Image.open(temp_png).crop((0, 0, width, height))
    img.save(output_png)
    if os.path.exists(temp_html): os.remove(temp_html)
    if os.path.exists(temp_png): os.remove(temp_png)

render_svg_to_png(dumbbell_svg, 132, 132, r"workout-timer-app\assets\dumbbell.png")
render_svg_to_png(cloud_svg, 60, 60, r"workout-timer-app\assets\download-cloud.png")
print("Icons generated successfully!")
