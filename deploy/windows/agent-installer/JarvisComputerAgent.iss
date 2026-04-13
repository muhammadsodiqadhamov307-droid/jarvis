#define AppName "JARVIS Computer Agent"
#define AppPublisher "JARVIS Workshop"
#ifndef AppVersion
#define AppVersion "1.0.0"
#endif
#ifndef AppSource
#define AppSource "..\..\..\release\jarvis-computer-agent"
#endif

[Setup]
AppId={{B90B3B6A-17F4-4A7A-97C3-646F5A2E96CB}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\JARVIS Computer Agent
DefaultGroupName=JARVIS Computer Agent
DisableProgramGroupPage=yes
OutputDir=..\..\..\release\installer
OutputBaseFilename=JarvisComputerAgent-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\start-agent.cmd

[Tasks]
Name: "autostart"; Description: "Start the JARVIS Computer Agent when Windows starts"; GroupDescription: "Startup"; Flags: checkedonce

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\JARVIS Computer Agent"; Filename: "{app}\start-agent.cmd"; WorkingDir: "{app}"
Name: "{userstartup}\JARVIS Computer Agent"; Filename: "{app}\start-agent.cmd"; WorkingDir: "{app}"; Tasks: autostart

[Run]
Filename: "{app}\start-agent.cmd"; Description: "Start JARVIS Computer Agent"; Flags: nowait postinstall skipifsilent
