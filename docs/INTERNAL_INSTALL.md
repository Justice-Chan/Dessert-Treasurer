# Internal installation

This build is for authorized internal use. It is not signed with an Apple Developer ID or notarized by Apple.

## Install the app

1. Download the DMG from the GitHub Release.
2. Double-click the downloaded DMG.
3. Drag `Dessert Treasurer.app` into the Applications folder shown in the DMG window.
4. Eject the DMG.

## First launch

macOS may report the downloaded app as damaged because this internal build is not notarized. After confirming that the DMG came from the club's GitHub repository, open Terminal and run:

~~~sh
xattr -dr com.apple.quarantine "/Applications/Dessert Treasurer.app"
open "/Applications/Dessert Treasurer.app"
~~~

After it opens, drag the app from Applications to the Dock, or choose **Options > Keep in Dock** from its Dock icon.

## Data and backups

The app stores its data only on the local Mac. Installations and app updates do not remove existing data. Download a complete JSON backup after every monthly close and before restoring any backup file.

See [Data and backups](DATA.md) for the storage location and recovery guidance.
