//! Document text encoding: detect on read, preserve on write.
//!
//! The fs plugin's `readTextFile` / `writeTextFile` are UTF-8 only, so a
//! GBK / Big5 / Shift_JIS markdown file opened as mojibake, and a UTF-8
//! BOM leaked into the text as U+FEFF (breaking frontmatter detection).
//!
//! Read: BOM first (UTF-8 / UTF-16LE / UTF-16BE); otherwise valid UTF-8 is
//! UTF-8; otherwise `chardetng` (Firefox's detector) guesses the legacy
//! encoding and `encoding_rs` decodes it.
//!
//! Write: back in the document's own encoding so other tools keep reading
//! it. If the text holds a character that encoding can't represent (an
//! emoji typed into a GBK file), fall back to UTF-8 rather than write
//! `encoding_rs`'s `&#NNNN;` replacement — never lose text — and report it.
//! Writes are atomic: a sibling `.tmp`, then rename over the target.

use std::fs;
use std::io::Write;
use std::path::Path;

use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde::{Deserialize, Serialize};

/// How a document's bytes map to text. Round-trips through the frontend
/// so a save writes the same encoding the read found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextCodec {
    /// WHATWG encoding name (`encoding_rs::Encoding::name`), e.g. "UTF-8",
    /// "GBK", "Big5", "Shift_JIS", "UTF-16LE".
    pub encoding: String,
    /// The file starts with a byte-order mark (kept on save).
    pub bom: bool,
}

impl TextCodec {
    fn utf8() -> Self {
        Self { encoding: UTF_8.name().to_string(), bom: false }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedText {
    pub text: String,
    pub codec: TextCodec,
    /// Some bytes didn't decode and became U+FFFD (likely a wrong guess or
    /// a corrupt file). Saving would make those replacements permanent.
    pub malformed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    /// The codec actually written (differs from the request on fallback).
    pub codec: TextCodec,
    /// The requested encoding couldn't represent the text; wrote UTF-8.
    pub fell_back_to_utf8: bool,
}

/// Decode raw file bytes, detecting the encoding.
pub fn decode(bytes: &[u8]) -> DecodedText {
    // BOM sniffing covers UTF-8 / UTF-16LE / UTF-16BE.
    if let Some((encoding, bom_len)) = Encoding::for_bom(bytes) {
        let (text, malformed) = encoding.decode_without_bom_handling(&bytes[bom_len..]);
        return DecodedText {
            text: text.into_owned(),
            codec: TextCodec { encoding: encoding.name().to_string(), bom: true },
            malformed,
        };
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return DecodedText { text: text.to_string(), codec: TextCodec::utf8(), malformed: false };
    }
    let mut detector = EncodingDetector::new();
    detector.feed(bytes, true);
    // No TLD hint; allow UTF-8 (irrelevant here — it already failed above).
    let encoding = detector.guess(None, true);
    let (text, malformed) = encoding.decode_without_bom_handling(bytes);
    DecodedText {
        text: text.into_owned(),
        codec: TextCodec { encoding: encoding.name().to_string(), bom: false },
        malformed,
    }
}

/// Encode `text` for `codec`. Returns the bytes and the codec actually
/// used (UTF-8 when `codec` can't represent the text).
pub fn encode(text: &str, codec: &TextCodec) -> (Vec<u8>, WriteOutcome) {
    let encoding = Encoding::for_label(codec.encoding.as_bytes()).unwrap_or(UTF_8);
    let mut out = Vec::with_capacity(text.len() + 3);

    // encoding_rs's UTF-16 "encoders" emit UTF-8 (per the WHATWG spec), so
    // UTF-16 is serialized by hand. UTF-16 can represent every string.
    if encoding == UTF_16LE || encoding == UTF_16BE {
        let le = encoding == UTF_16LE;
        if codec.bom {
            out.extend_from_slice(if le { &[0xFF, 0xFE] } else { &[0xFE, 0xFF] });
        }
        for unit in text.encode_utf16() {
            out.extend_from_slice(&if le { unit.to_le_bytes() } else { unit.to_be_bytes() });
        }
        let codec = TextCodec { encoding: encoding.name().to_string(), bom: codec.bom };
        return (out, WriteOutcome { codec, fell_back_to_utf8: false });
    }

    if encoding != UTF_8 {
        let (bytes, _, unmappable) = encoding.encode(text);
        if !unmappable {
            out.extend_from_slice(&bytes);
            let codec = TextCodec { encoding: encoding.name().to_string(), bom: false };
            return (out, WriteOutcome { codec, fell_back_to_utf8: false });
        }
    }

    // UTF-8: requested, or the fallback. A BOM is kept only if the
    // document was already BOM-marked UTF-8.
    let fell_back = encoding != UTF_8;
    let bom = !fell_back && codec.bom;
    if bom {
        out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    out.extend_from_slice(text.as_bytes());
    let codec = TextCodec { encoding: UTF_8.name().to_string(), bom };
    (out, WriteOutcome { codec, fell_back_to_utf8: fell_back })
}

/// Read a document, detecting its encoding.
pub fn read_document(path: &Path) -> Result<DecodedText, String> {
    let bytes = fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(decode(&bytes))
}

/// Encode and atomically write a document: the bytes go to a sibling
/// `<path>.tmp`, which is then renamed over the target (atomic on the same
/// volume), so a crash mid-save leaves the original intact. A failed write
/// removes the orphaned tmp.
pub fn write_document(path: &Path, text: &str, codec: &TextCodec) -> Result<WriteOutcome, String> {
    let (bytes, outcome) = encode(text, codec);
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = Path::new(&tmp);
    let result = (|| {
        let mut file = fs::File::create(tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(tmp, path)
    })();
    if let Err(err) = result {
        let _ = fs::remove_file(tmp);
        return Err(format!("{}: {err}", path.display()));
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codec(encoding: &str, bom: bool) -> TextCodec {
        TextCodec { encoding: encoding.to_string(), bom }
    }

    #[test]
    fn plain_utf8_round_trips_without_bom() {
        let d = decode("# 标题\nhello".as_bytes());
        assert_eq!(d.text, "# 标题\nhello");
        assert_eq!(d.codec, codec("UTF-8", false));
        assert!(!d.malformed);
        let (bytes, out) = encode(&d.text, &d.codec);
        assert_eq!(bytes, "# 标题\nhello".as_bytes());
        assert!(!out.fell_back_to_utf8);
    }

    #[test]
    fn utf8_bom_is_stripped_on_read_and_restored_on_write() {
        let raw = [&[0xEF, 0xBB, 0xBF][..], b"---\ntitle: x\n---\n"].concat();
        let d = decode(&raw);
        assert_eq!(d.text, "---\ntitle: x\n---\n"); // no U+FEFF in front of the frontmatter
        assert_eq!(d.codec, codec("UTF-8", true));
        assert_eq!(encode(&d.text, &d.codec).0, raw);
    }

    #[test]
    fn gbk_is_detected_and_written_back_as_gbk() {
        let text = "# 中文标题\n\n这是一段使用 GBK 编码保存的中文文档，用来测试编码检测。\n";
        let (gbk, _, _) = encoding_rs::GBK.encode(text);
        let d = decode(&gbk);
        assert_eq!(d.codec, codec("GBK", false));
        assert_eq!(d.text, text);
        let (bytes, out) = encode(&d.text, &d.codec);
        assert_eq!(bytes, gbk.into_owned());
        assert!(!out.fell_back_to_utf8);
    }

    #[test]
    fn unmappable_text_falls_back_to_utf8_instead_of_losing_characters() {
        let text = "中文 with emoji 😀";
        let (bytes, out) = encode(text, &codec("GBK", false));
        assert!(out.fell_back_to_utf8);
        assert_eq!(out.codec, codec("UTF-8", false));
        assert_eq!(bytes, text.as_bytes());
    }

    #[test]
    fn utf16le_with_bom_round_trips() {
        let text = "# héllo 世界";
        let mut raw = vec![0xFF, 0xFE];
        for u in text.encode_utf16() {
            raw.extend_from_slice(&u.to_le_bytes());
        }
        let d = decode(&raw);
        assert_eq!(d.codec, codec("UTF-16LE", true));
        assert_eq!(d.text, text);
        assert_eq!(encode(&d.text, &d.codec).0, raw);
    }

    #[test]
    fn atomic_write_replaces_the_file_and_leaves_no_tmp() {
        let dir = std::env::temp_dir().join(format!("mdr-codec-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("doc.md");
        fs::write(&path, "old").unwrap();
        let out = write_document(&path, "新内容", &codec("GBK", false)).unwrap();
        assert_eq!(out.codec, codec("GBK", false));
        assert_eq!(read_document(&path).unwrap().text, "新内容");
        assert!(!dir.join("doc.md.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn failed_write_keeps_the_target_and_removes_the_tmp() {
        let dir = std::env::temp_dir().join(format!("mdr-codec-fail-{}", std::process::id()));
        // The "document" is a non-empty directory, so the final rename fails.
        let path = dir.join("doc.md");
        fs::create_dir_all(path.join("keep")).unwrap();
        assert!(write_document(&path, "x", &codec("UTF-8", false)).is_err());
        assert!(path.join("keep").is_dir());
        assert!(!dir.join("doc.md.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
