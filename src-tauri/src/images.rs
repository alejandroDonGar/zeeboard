//! Image processing and storage.
//!
//! Original canvases can weigh 40–70 MB. The app keeps only two light copies:
//! - a viewing version, at most `VIEW_MAX_SIDE` px on a side, in WebP;
//! - a `THUMB_MAX_SIDE` px thumbnail for cards, lists and carousels.
//!
//! Files are named by the original's hash: importing the same image twice
//! reuses the existing files.

use std::fs;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};

use fast_image_resize::images::{Image as ResizedImage, ImageRef};
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::{DynamicImage, ImageDecoder, ImageReader, Limits, RgbaImage};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const VIEW_MAX_SIDE: u32 = 2560;
const THUMB_MAX_SIDE: u32 = 480;
const VIEW_QUALITY: f32 = 82.0;
const THUMB_QUALITY: f32 = 72.0;

const IMAGES_DIR: &str = "images";
const THUMBS_DIR: &str = "images/thumbs";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredImage {
    /// Path relative to the app data folder, e.g. `images/ab12….webp`
    path: String,
    thumb_path: String,
    width: u32,
    height: u32,
    /// Size in bytes of the viewing version
    bytes: u64,
    /// `true` if the image already existed and needed no processing
    reused: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    image_count: u32,
    images_bytes: u64,
    thumbs_bytes: u64,
    database_bytes: u64,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

/// Reads the image with correct orientation (phone photos) and no size limit.
fn decode(bytes: &[u8]) -> Result<RgbaImage, String> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| format!("No se pudo leer la imagen: {error}"))?;
    reader.limits(Limits::no_limits());

    let mut decoder = reader
        .into_decoder()
        .map_err(|error| format!("Formato de imagen no compatible: {error}"))?;
    let orientation = decoder.orientation().ok();

    let mut image = DynamicImage::from_decoder(decoder)
        .map_err(|error| format!("No se pudo decodificar la imagen: {error}"))?;
    if let Some(orientation) = orientation {
        image.apply_orientation(orientation);
    }

    Ok(image.into_rgba8())
}

/// Downscales the image so its longest side doesn't exceed `max_side`. Never upscales.
fn shrink(source: &RgbaImage, max_side: u32) -> Result<RgbaImage, String> {
    let (width, height) = source.dimensions();
    let longest = width.max(height);

    if longest <= max_side {
        return Ok(source.clone());
    }

    let scale = max_side as f64 / longest as f64;
    let new_width = ((width as f64 * scale).round() as u32).max(1);
    let new_height = ((height as f64 * scale).round() as u32).max(1);

    let source_ref = ImageRef::new(width, height, source.as_raw(), PixelType::U8x4)
        .map_err(|error| error.to_string())?;
    let mut target = ResizedImage::new(new_width, new_height, PixelType::U8x4);

    Resizer::new()
        .resize(
            &source_ref,
            &mut target,
            &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3)),
        )
        .map_err(|error| error.to_string())?;

    RgbaImage::from_raw(new_width, new_height, target.into_vec())
        .ok_or_else(|| "No se pudo crear la imagen reducida".to_string())
}

fn encode_webp(image: &RgbaImage, quality: f32) -> Vec<u8> {
    let (width, height) = image.dimensions();
    webp::Encoder::from_rgba(image.as_raw(), width, height)
        .encode(quality)
        .to_vec()
}

/// Writes to a temp file first, then renames:
/// so a half-written image never remains if the app closes mid-write.
fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn process(base_dir: &Path, original: &[u8]) -> Result<StoredImage, String> {
    let hash = Sha256::digest(original);
    let name: String = hash.iter().take(12).map(|byte| format!("{byte:02x}")).collect();

    let path = format!("{IMAGES_DIR}/{name}.webp");
    let thumb_path = format!("{THUMBS_DIR}/{name}.webp");
    let full_path = base_dir.join(&path);
    let full_thumb_path = base_dir.join(&thumb_path);

    fs::create_dir_all(base_dir.join(THUMBS_DIR)).map_err(|error| error.to_string())?;

    // The same image was imported before: reuse its files
    if full_path.exists() && full_thumb_path.exists() {
        let (width, height) =
            image::image_dimensions(&full_path).map_err(|error| error.to_string())?;
        let bytes = fs::metadata(&full_path).map_err(|error| error.to_string())?.len();
        return Ok(StoredImage { path, thumb_path, width, height, bytes, reused: true });
    }

    let decoded = decode(original)?;
    let view = shrink(&decoded, VIEW_MAX_SIDE)?;
    drop(decoded); // frees the full canvas memory as soon as possible
    let thumb = shrink(&view, THUMB_MAX_SIDE)?;

    let view_bytes = encode_webp(&view, VIEW_QUALITY);
    write_atomically(&full_path, &view_bytes)?;
    write_atomically(&full_thumb_path, &encode_webp(&thumb, THUMB_QUALITY))?;

    let (width, height) = view.dimensions();
    Ok(StoredImage {
        path,
        thumb_path,
        width,
        height,
        bytes: view_bytes.len() as u64,
        reused: false,
    })
}

/// Only relative paths inside `images/` are accepted: nothing outside is ever deleted.
fn safe_image_path(base_dir: &Path, relative: &str) -> Option<PathBuf> {
    let relative_path = Path::new(relative);
    let inside_images = relative.starts_with(&format!("{IMAGES_DIR}/"));
    let only_normal_parts = relative_path
        .components()
        .all(|component| matches!(component, Component::Normal(_)));

    (inside_images && only_normal_parts).then(|| base_dir.join(relative_path))
}

fn folder_size(folder: &Path) -> (u32, u64) {
    let Ok(entries) = fs::read_dir(folder) else {
        return (0, 0);
    };

    entries
        .flatten()
        .filter_map(|entry| entry.metadata().ok().filter(|metadata| metadata.is_file()))
        .fold((0, 0), |(count, total), metadata| (count + 1, total + metadata.len()))
}

/// Imports an image already in memory (received from the iPad).
pub(crate) fn import_bytes(app: &AppHandle, original: &[u8]) -> Result<StoredImage, String> {
    process(&data_dir(app)?, original)
}

/// Reads a stored image file (path relative to the data folder, inside `images/`); `None` if it isn't there.
pub(crate) fn read_image(app: &AppHandle, relative: &str) -> Option<Vec<u8>> {
    let path = safe_image_path(&data_dir(app).ok()?, relative)?;
    fs::read(path).ok()
}

/// Imports an image from a disk file (picker, drag and drop, migration).
#[tauri::command]
pub async fn import_image_from_path(app: AppHandle, path: String) -> Result<StoredImage, String> {
    let base_dir = data_dir(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        let original = fs::read(&path).map_err(|error| format!("No se pudo abrir {path}: {error}"))?;
        process(&base_dir, &original)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Imports an image received as bytes (clipboard paste).
/// The bytes arrive as binary, without going through JSON or base64.
#[tauri::command]
pub async fn import_image_from_bytes(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<StoredImage, String> {
    let tauri::ipc::InvokeBody::Raw(original) = request.body() else {
        return Err("Se esperaban los bytes de la imagen".to_string());
    };
    let original = original.clone();
    let base_dir = data_dir(&app)?;

    tauri::async_runtime::spawn_blocking(move || process(&base_dir, &original))
        .await
        .map_err(|error| error.to_string())?
}

/// Deletes image files (viewing version and thumbnail).
#[tauri::command]
pub fn delete_image_files(app: AppHandle, paths: Vec<String>) -> Result<u32, String> {
    let base_dir = data_dir(&app)?;
    let mut deleted = 0;

    for path in paths.iter().filter_map(|relative| safe_image_path(&base_dir, relative)) {
        if fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }

    Ok(deleted)
}

/// Deletes the images and thumbnails not listed in `used_paths`.
#[tauri::command]
pub fn cleanup_orphan_images(app: AppHandle, used_paths: Vec<String>) -> Result<u32, String> {
    let base_dir = data_dir(&app)?;
    let used: std::collections::HashSet<String> = used_paths.into_iter().collect();
    let mut deleted = 0;

    for folder in [IMAGES_DIR, THUMBS_DIR] {
        let Ok(entries) = fs::read_dir(base_dir.join(folder)) else {
            continue;
        };

        for entry in entries.flatten() {
            let is_file = entry.metadata().map(|metadata| metadata.is_file()).unwrap_or(false);
            let relative = format!("{folder}/{}", entry.file_name().to_string_lossy());

            if is_file && !used.contains(&relative) && fs::remove_file(entry.path()).is_ok() {
                deleted += 1;
            }
        }
    }

    Ok(deleted)
}

/// Space used by images, thumbnails and the database.
#[tauri::command]
pub fn storage_stats(app: AppHandle) -> Result<StorageStats, String> {
    let base_dir = data_dir(&app)?;
    let (image_count, images_bytes) = folder_size(&base_dir.join(IMAGES_DIR));
    let (_, thumbs_bytes) = folder_size(&base_dir.join(THUMBS_DIR));
    let database_bytes = fs::metadata(base_dir.join("zeeboard.db"))
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    Ok(StorageStats { image_count, images_bytes, thumbs_bytes, database_bytes })
}
