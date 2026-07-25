from PIL import Image
import os

source_path = "src/assets/brand/gitoutbox-app-icon.png"
img = Image.open(source_path).convert("RGBA")

# Crop to non-transparent bounding box
bbox = img.getbbox()
print("Original size:", img.size, "BBox:", bbox)

cropped = img.crop(bbox)
c_width, c_height = cropped.size

# Target square size for master high-res icon
master_size = 1024
# Make logo fill ~92% of the canvas
max_dim = max(c_width, c_height)
scale = (master_size * 0.92) / max_dim

new_w = int(c_width * scale)
new_h = int(c_height * scale)

resized_logo = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)

# Create new transparent canvas
master_img = Image.new("RGBA", (master_size, master_size), (0, 0, 0, 0))
offset_x = (master_size - new_w) // 2
offset_y = (master_size - new_h) // 2

master_img.paste(resized_logo, (offset_x, offset_y), resized_logo)

# Save master
master_img.save("src/assets/brand/gitoutbox-app-icon.png")
if os.path.exists("assets/gitoutbox-app-icon.png"):
    master_img.save("assets/gitoutbox-app-icon.png")

print("New master icon generated! BBox:", master_img.getbbox())

# Re-generate all Tauri icons
sizes_map = {
    "src-tauri/icons/16x16.png": (16, 16),
    "src-tauri/icons/32x32.png": (32, 32),
    "src-tauri/icons/64x64.png": (64, 64),
    "src-tauri/icons/128x128.png": (128, 128),
    "src-tauri/icons/128x128@2x.png": (256, 256),
    "src-tauri/icons/Square30x30Logo.png": (30, 30),
    "src-tauri/icons/Square44x44Logo.png": (44, 44),
    "src-tauri/icons/Square71x71Logo.png": (71, 71),
    "src-tauri/icons/Square89x89Logo.png": (89, 89),
    "src-tauri/icons/Square107x107Logo.png": (107, 107),
    "src-tauri/icons/Square142x142Logo.png": (142, 142),
    "src-tauri/icons/Square150x150Logo.png": (150, 150),
    "src-tauri/icons/Square284x284Logo.png": (284, 284),
    "src-tauri/icons/Square310x310Logo.png": (310, 310),
    "src-tauri/icons/StoreLogo.png": (50, 50),
    "src-tauri/icons/icon.png": (512, 512),
}

for path, size in sizes_map.items():
    os.makedirs(os.path.dirname(path), exist_ok=True)
    res_img = master_img.resize(size, Image.Resampling.LANCZOS)
    res_img.save(path)

# Generate multi-resolution .ico
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ico_images = [master_img.resize(s, Image.Resampling.LANCZOS) for s in ico_sizes]
ico_images[0].save(
    "src-tauri/icons/icon.ico",
    format="ICO",
    sizes=ico_sizes,
    append_images=ico_images[1:]
)

print("All PNG and ICO icon assets regenerated successfully!")
