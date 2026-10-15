//! Receiving images from the iPad.
//!
//! A tiny HTTP server that lives only while the user has it switched on (Settings). The iPad reaches it
//! through Tailscale (works over mobile data) or the local network, opens a page, picks a commission and a
//! stage, and sends photos. Every request needs the secret key from the link; without it nothing is served.
//!
//! The database lives on the frontend side, so a received image is processed here (same WebP pipeline as
//! any other image) and announced with the `ipad-image` event; the frontend then adds it to the stage.

use std::collections::HashMap;
use std::io::Read;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tiny_http::{Header, Method, Request, Response, Server};

use crate::images::{self, StoredImage};

const PAGE: &str = include_str!("ipad_page.html");
/// A 70 MB canvas fits easily; anything bigger is refused
const MAX_UPLOAD: u64 = 200 * 1024 * 1024;
/// One upload at a time: several 200 MB uploads at once could exhaust the memory
static UPLOADING: AtomicBool = AtomicBool::new(false);

/// Only devices that can be the user's iPad: local network, Tailscale (100.64.0.0/10 and fd7a:115c:a1e0::/48)
/// or this PC. If the port ever ends up open to the internet, everyone else is refused before reading anything.
fn allowed_peer(peer: Option<&SocketAddr>) -> bool {
    match peer.map(|address| address.ip()) {
        Some(IpAddr::V4(ip)) => {
            let [a, b, ..] = ip.octets();
            ip.is_private() || ip.is_loopback() || ip.is_link_local() || (a == 100 && (64..128).contains(&b))
        }
        Some(IpAddr::V6(ip)) => {
            let segments = ip.segments();
            ip.is_loopback()
                || segments[0] & 0xffc0 == 0xfe80 // link-local
                || segments[0] & 0xfe00 == 0xfc00 // unique local (Tailscale's fd7a:… is one)
                || ip.to_ipv4_mapped().is_some_and(|v4| allowed_peer(Some(&SocketAddr::new(IpAddr::V4(v4), 0))))
        }
        None => false,
    }
}

/// Compares the key without stopping at the first different character (no timing hints)
fn same_key(given: Option<&&str>, key: &str) -> bool {
    given.is_some_and(|given| {
        given.len() == key.len() && given.bytes().zip(key.bytes()).fold(0u8, |diff, (a, b)| diff | (a ^ b)) == 0
    })
}

#[derive(Default)]
pub struct IpadState {
    server: Mutex<Option<Arc<Server>>>,
    /// JSON with the open commissions and their stages, pushed by the frontend
    snapshot: Arc<Mutex<String>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IpadImage {
    commission_id: i64,
    stage_id: i64,
    /// Set when the image is a new version of that alternative of the stage; none = a new alternative
    alt: Option<i64>,
    stored: StoredImage,
}

fn send(request: Request, status: u16, content_type: &str, body: impl Into<Vec<u8>>) {
    let mut response = Response::from_data(body.into()).with_status_code(status);

    for (name, value) in [("Content-Type", content_type), ("Cache-Control", "no-store")] {
        if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
        }
    }

    let _ = request.respond(response);
}

fn upload(app: &AppHandle, request: Request, params: &HashMap<&str, &str>) {
    if UPLOADING.swap(true, Ordering::AcqRel) {
        return send(request, 429, "text/plain; charset=utf-8", "Ya se está recibiendo otra imagen. Espera un momento");
    }

    // Freed when this ends, even if processing the image panics
    struct Done;
    impl Drop for Done {
        fn drop(&mut self) {
            UPLOADING.store(false, Ordering::Release);
        }
    }
    let _done = Done;

    receive(app, request, params);
}

fn receive(app: &AppHandle, mut request: Request, params: &HashMap<&str, &str>) {
    let ids = (|| Some((params.get("commission")?.parse::<i64>().ok()?, params.get("stage")?.parse::<i64>().ok()?)))();
    let Some((commission_id, stage_id)) = ids else {
        return send(request, 400, "text/plain; charset=utf-8", "Faltan la comisión o la etapa");
    };

    let alt = params.get("alt").and_then(|alt| alt.parse::<i64>().ok());

    if request.body_length().is_some_and(|length| length as u64 > MAX_UPLOAD) {
        return send(request, 413, "text/plain; charset=utf-8", "La imagen es demasiado grande");
    }

    let mut bytes = Vec::new();
    let read = request.as_reader().take(MAX_UPLOAD + 1).read_to_end(&mut bytes);

    if read.is_err() || bytes.is_empty() || bytes.len() as u64 > MAX_UPLOAD {
        return send(request, 400, "text/plain; charset=utf-8", "No se pudo recibir la imagen");
    }

    // Decoding is the validation: anything that is not an image is refused here
    match images::import_bytes(app, &bytes) {
        Ok(stored) => {
            let _ = app.emit("ipad-image", IpadImage { commission_id, stage_id, alt, stored });
            send(request, 200, "application/json", r#"{"ok":true}"#);
        }
        Err(error) => send(request, 422, "text/plain; charset=utf-8", error),
    }
}

fn handle(app: AppHandle, request: Request, token: String, snapshot: Arc<Mutex<String>>) {
    let url = request.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((url.as_str(), ""));
    let params: HashMap<&str, &str> = query.split('&').filter_map(|pair| pair.split_once('=')).collect();

    if !allowed_peer(request.remote_addr()) {
        return send(request, 403, "text/plain; charset=utf-8", "Solo desde tu red local o Tailscale.");
    }

    if !same_key(params.get("k"), &token) {
        return send(request, 403, "text/plain; charset=utf-8", "Enlace no valido. Escanea de nuevo el codigo de ZeeBoard.");
    }

    let method = request.method().clone();

    match (method, path) {
        (Method::Get, "/") => send(request, 200, "text/html; charset=utf-8", PAGE),
        (Method::Get, "/api/commissions") => {
            let json = snapshot.lock().map(|json| json.clone()).unwrap_or_default();
            let json = if json.is_empty() { r#"{"commissions":[]}"#.to_string() } else { json };
            send(request, 200, "application/json", json);
        }
        // Thumbnails for the alternatives list; nothing outside images/thumbs/ is ever served
        (Method::Get, "/thumb") => match params.get("p").filter(|path| path.starts_with("images/thumbs/")) {
            Some(path) => match images::read_image(&app, path) {
                Some(bytes) => send(request, 200, "image/webp", bytes),
                None => send(request, 404, "text/plain; charset=utf-8", "No encontrado"),
            },
            None => send(request, 404, "text/plain; charset=utf-8", "No encontrado"),
        },
        // Full-size references, to save them on the iPad: only images the snapshot lists are served
        (Method::Get, "/image") => {
            let listed = params.get("p").filter(|path| {
                snapshot.lock().is_ok_and(|json| json.contains(&format!("\"image\":\"{path}\"")))
            });
            match listed.and_then(|path| images::read_image(&app, path)) {
                Some(bytes) => send(request, 200, "image/webp", bytes),
                None => send(request, 404, "text/plain; charset=utf-8", "No encontrado"),
            }
        }
        (Method::Post, "/upload") => upload(&app, request, &params),
        _ => send(request, 404, "text/plain; charset=utf-8", "No encontrado"),
    }
}

fn stop(state: &IpadState) {
    if let Some(server) = state.server.lock().ok().and_then(|mut server| server.take()) {
        server.unblock();
    }
}

#[tauri::command]
pub fn ipad_start(app: AppHandle, state: State<IpadState>, port: u16, token: String) -> Result<(), String> {
    if token.len() < 16 {
        return Err("La clave es demasiado corta".to_string());
    }

    stop(&state);

    // Only for tests: `ZEEBOARD_IPAD_BIND=127.0.0.1` keeps the server off the network (and off the firewall prompt)
    let bind = std::env::var("ZEEBOARD_IPAD_BIND").unwrap_or_else(|_| "0.0.0.0".to_string());

    // A restart (new key) can find the port still closing: a few short retries
    let mut attempt = 0;
    let server = loop {
        match Server::http((bind.as_str(), port)) {
            Ok(server) => break Arc::new(server),
            Err(_) if attempt < 10 => {
                attempt += 1;
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(format!("No se pudo abrir el puerto {port}: {error}")),
        }
    };

    if let Ok(mut current) = state.server.lock() {
        *current = Some(server.clone());
    }

    let snapshot = state.snapshot.clone();

    thread::spawn(move || {
        for request in server.incoming_requests() {
            let (app, token, snapshot) = (app.clone(), token.clone(), snapshot.clone());
            thread::spawn(move || handle(app, request, token, snapshot));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn ipad_stop(state: State<IpadState>) {
    stop(&state);
}

#[tauri::command]
pub fn ipad_set_snapshot(state: State<IpadState>, json: String) {
    if let Ok(mut snapshot) = state.snapshot.lock() {
        *snapshot = json;
    }
}

/// IPv4 addresses of this PC (the Tailscale one starts with 100.)
#[tauri::command]
pub fn ipad_addresses() -> Vec<String> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|interface| match interface.ip() {
            std::net::IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_link_local() => Some(ip.to_string()),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(address: &str) -> bool {
        allowed_peer(Some(&SocketAddr::new(address.parse().unwrap(), 1234)))
    }

    #[test]
    fn only_local_network_tailscale_and_this_pc() {
        for ok in ["192.168.1.34", "10.0.0.5", "172.20.1.1", "100.84.12.7", "127.0.0.1", "169.254.3.3", "fd7a:115c:a1e0::1", "fe80::1", "::1", "::ffff:192.168.1.2"] {
            assert!(peer(ok), "{ok} should be allowed");
        }
        for no in ["8.8.8.8", "100.128.0.1", "100.63.255.255", "2001:4860::8888", "::ffff:8.8.8.8"] {
            assert!(!peer(no), "{no} should be refused");
        }
        assert!(!allowed_peer(None));
    }

    #[test]
    fn key_must_match_exactly() {
        let key = "0123456789abcdef0123456789abcdef";
        assert!(same_key(Some(&key), key));
        assert!(!same_key(Some(&"0123456789abcdef0123456789abcdee"), key));
        assert!(!same_key(Some(&"0123456789abcdef"), key), "a prefix is not the key");
        assert!(!same_key(None, key));
    }
}
