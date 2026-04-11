#define AppName "JARVIS AI"
#define AppPublisher "JARVIS Workshop"
#ifndef AppVersion
#define AppVersion "1.0.0"
#endif
#ifndef AppSource
#define AppSource "..\..\..\release\jarvis-ai"
#endif

[Setup]
AppId={{7D5F1C10-0DF4-4F35-8A18-6C77DB0CFB6A}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\JARVIS AI
DefaultGroupName=JARVIS AI
DisableProgramGroupPage=yes
OutputDir=..\..\..\release\installer
OutputBaseFilename=JarvisAI-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\start-jarvis.cmd

[Tasks]
Name: "autostart"; Description: "Start JARVIS when Windows starts"; GroupDescription: "Startup"; Flags: checkedonce

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\JARVIS AI"; Filename: "{app}\start-jarvis.cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\JARVIS AI"; Filename: "{app}\start-jarvis.cmd"; WorkingDir: "{app}"
Name: "{userstartup}\JARVIS AI"; Filename: "{app}\start-jarvis.cmd"; WorkingDir: "{app}"; Tasks: autostart

[Run]
Filename: "{app}\start-jarvis.cmd"; Description: "Launch JARVIS AI"; Flags: nowait postinstall skipifsilent
