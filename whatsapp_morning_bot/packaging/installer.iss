; Inno Setup script — Mesaj Botu kurulum sihirbazı
; Derleme: Inno Setup Compiler ile bu dosyayı aç ve "Compile" et,
; veya: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" build\installer.iss
;
; ÖN KOŞUL: önce `pyinstaller build/MesajBotu.spec` çalıştırılmış ve
; dist\MesajBotu\MesajBotu.exe üretilmiş olmalıdır.

#define AppName "Mesaj Botu"
#define AppVersion "1.0.0"
#define AppPublisher "Yusuf Bilal Cetin"
#define AppExeName "MesajBotu.exe"

[Setup]
AppId={{9F3B2A1C-7E54-4D6A-9C2B-MESAJBOTU01}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\Mesaj Botu
DefaultGroupName=Mesaj Botu
DisableProgramGroupPage=yes
OutputDir=installer
OutputBaseFilename=MesajBotu-Setup-{#AppVersion}
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Masaüstü kısayolu oluştur"; GroupDescription: "Ek görevler:"

[Files]
; PyInstaller COLLECT çıktısının tamamı (dist\MesajBotu\*)
Source: "..\dist\MesajBotu\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Mesaj Botu"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Mesaj Botu'nu Kaldır"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Mesaj Botu"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Mesaj Botu'nu çalıştır"; Flags: nowait postinstall skipifsilent
