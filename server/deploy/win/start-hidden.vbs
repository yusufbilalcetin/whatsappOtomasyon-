' run-motor.bat'i gizli pencerede baslatir (konsol penceresi gorunmesin).
Set sh = CreateObject("WScript.Shell")
batPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\run-motor.bat"
sh.Run """" & batPath & """", 0, False
