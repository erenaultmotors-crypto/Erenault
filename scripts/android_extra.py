"""Android projesine ana ekran 'Asistan' kısayolunu ve erenault:// bağlantısını ekler (app/ klasöründen çalışır)."""
import os, re
R = 'android/app/src/main'
os.makedirs(R + '/res/xml', exist_ok=True)
open(R + '/res/xml/shortcuts.xml', 'w').write('''<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut android:shortcutId="asistan" android:enabled="true" android:icon="@mipmap/ic_launcher"
      android:shortcutShortLabel="@string/sc_asistan" android:shortcutLongLabel="@string/sc_asistan_uzun">
    <intent android:action="android.intent.action.VIEW" android:data="erenault://asistan"
        android:targetPackage="com.erenault.app" android:targetClass="com.erenault.app.MainActivity" />
  </shortcut>
</shortcuts>
''')
sp = R + '/res/values/strings.xml'
s = open(sp).read()
if 'sc_asistan' not in s:
    s = s.replace('</resources>', '    <string name="sc_asistan">Asistan</string>\n    <string name="sc_asistan_uzun">Eren Oto Asistan</string>\n</resources>')
    open(sp, 'w').write(s)
mp = R + '/AndroidManifest.xml'
m = open(mp).read()
if 'android.app.shortcuts' not in m:
    add = '''            <meta-data android:name="android.app.shortcuts" android:resource="@xml/shortcuts" />
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="erenault" />
            </intent-filter>
'''
    m2 = re.sub(r'(<category android:name="android.intent.category.LAUNCHER"\s*/>\s*</intent-filter>\n)', lambda x: x.group(1) + add, m, count=1)
    assert m2 != m, 'manifest: LAUNCHER bulunamadı'
    open(mp, 'w').write(m2)
print('android_extra ok')
