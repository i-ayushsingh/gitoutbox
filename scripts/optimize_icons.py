import os
from PIL import Image

def crop_and_center_square(input_path, output_path, target_size=1024, fill_percent=0.85):
    """
    Crops the transparent boundary of an image and centers the opaque logo 
    on a square transparent canvas such that the max dimension fills fill_percent of target_size.
    """
    if not os.path.exists(input_path):
        print(f"Skipping missing file: {input_path}")
        return None

    img = Image.open(input_path).convert("RGBA")
    bbox = img.getbbox()
    if not bbox:
        print(f"Warning: Empty image {input_path}")
        return None

    # Crop to opaque content
    cropped = img.crop(bbox)
    crop_w, crop_h = cropped.size

    # Calculate scale factor so max dimension matches fill_percent * target_size
    max_target_dim = target_size * fill_percent
    scale = max_target_dim / max(crop_w, crop_h)

    new_w = max(1, int(round(crop_w * scale)))
    new_h = max(1, int(round(crop_h * scale)))

    resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Create target square canvas
    canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))

    # Center resized logo
    offset_x = (target_size - new_w) // 2
    offset_y = (target_size - new_h) // 2
    canvas.paste(resized, (offset_x, offset_y), resized)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    canvas.save(output_path, "PNG")
    print(f"Optimized {input_path} -> {output_path} (Canvas {target_size}x{target_size}, Content {new_w}x{new_h})")
    return canvas

def crop_horizontal(input_path, output_path, padding_percent=0.08):
    """
    Crops horizontal transparent padding with tight uniform margin.
    """
    if not os.path.exists(input_path):
        return
    img = Image.open(input_path).convert("RGBA")
    bbox = img.getbbox()
    if not bbox:
        return

    cropped = img.crop(bbox)
    cw, ch = cropped.size
    pad_x = int(round(cw * padding_percent))
    pad_y = int(round(ch * padding_percent))

    tw, th = cw + pad_x * 2, ch + pad_y * 2
    canvas = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    canvas.paste(cropped, (pad_x, pad_y), cropped)
    
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    canvas.save(output_path, "PNG")
    print(f"Optimized horizontal {input_path} -> {output_path} ({tw}x{th})")

def generate_ico(master_canvas, output_path):
    """
    Generates multi-resolution .ico containing 16, 24, 32, 48, 64, 128, 256 px versions.
    """
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master_canvas.save(output_path, format="ICO", sizes=sizes)
    print(f"Generated multi-res ICO -> {output_path}")

def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    
    app_icon_src = os.path.join(root, "src", "assets", "brand", "gitoutbox-app-icon.png")
    primary_src = os.path.join(root, "src", "assets", "brand", "gitoutbox-primary-transparent.png")
    horiz_src = os.path.join(root, "src", "assets", "brand", "gitoutbox-horizontal-transparent.png")
    root_horiz_src = os.path.join(root, "assets", "gitoutbox-horizontal-transparent.png")

    # 1. Optimize Brand Assets
    master_icon = crop_and_center_square(app_icon_src, app_icon_src, target_size=1024, fill_percent=0.85)
    crop_and_center_square(primary_src, primary_src, target_size=1024, fill_percent=0.85)
    crop_horizontal(horiz_src, horiz_src)
    if os.path.exists(root_horiz_src):
        crop_horizontal(root_horiz_src, root_horiz_src)

    if not master_icon:
        print("Failed to load master icon")
        return

    # 2. Generate Tauri Icons
    tauri_icons_dir = os.path.join(root, "src-tauri", "icons")

    size_map = {
        "16x16.png": 16,
        "32x32.png": 32,
        "64x64.png": 64,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }

    for name, s in size_map.items():
        out_p = os.path.join(tauri_icons_dir, name)
        resized = master_icon.resize((s, s), Image.Resampling.LANCZOS)
        resized.save(out_p, "PNG")

    # Generate ICO
    ico_p = os.path.join(tauri_icons_dir, "icon.ico")
    generate_ico(master_icon, ico_p)

if __name__ == "__main__":
    main()
