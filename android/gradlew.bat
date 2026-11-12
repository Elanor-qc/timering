@echo off
setlocal
set DIRNAME=%~dp0
set TIMERING_JAVA=java
if defined JAVA_HOME set "TIMERING_JAVA=%JAVA_HOME%\bin\java.exe"
"%TIMERING_JAVA%" -classpath "%DIRNAME%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
exit /b %ERRORLEVEL%
