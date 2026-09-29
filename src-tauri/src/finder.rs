use std::path::PathBuf;

#[cfg(target_os = "macos")]
pub fn reveal(paths: &[PathBuf]) -> Result<(), String> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSArray, NSString, NSURL};

    let urls = paths
        .iter()
        .map(|path| NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy())))
        .collect::<Vec<_>>();
    NSWorkspace::sharedWorkspace()
        .activateFileViewerSelectingURLs(&NSArray::from_retained_slice(&urls));
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn reveal(_paths: &[PathBuf]) -> Result<(), String> {
    Err("Open in Finder is only available on macOS.".into())
}
