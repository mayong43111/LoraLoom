from pathlib import Path

from PyInstaller.utils.hooks import collect_all


project_root = Path(SPECPATH)
webview_datas, webview_binaries, webview_hiddenimports = collect_all("webview")

analysis = Analysis(
    [str(project_root / "app" / "desktop.py")],
    pathex=[str(project_root)],
    binaries=webview_binaries,
    datas=[
        (str(project_root / "web" / "dist"), "web/dist"),
        (str(project_root / "app" / "plugins"), "app/plugins"),
        *webview_datas,
    ],
    hiddenimports=webview_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="LoraLoom",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

distribution = COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="LoraLoom",
)