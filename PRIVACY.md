# Privacy

Holoshelf has no telemetry, analytics, ads, tracking pixels, or remote user accounts.

The app stores its user data locally in SQLite under the active data directory shown in Settings. In a normal installed Windows build, that directory is:

```text
%APPDATA%\Holoshelf\data
```

The local database can contain your tier boards, playlists, queue, markers, exclusions, custom talents, brackets, and optional API keys entered in Settings.

Network requests are made only for app features that need them, such as refreshing Holodex data, YouTube video stats, YouTube player embeds, or Hololive talent images. Those third-party services may receive standard request information from your computer according to their own policies.

Uninstalling Holoshelf removes the installed app files but does not delete `%APPDATA%\Holoshelf\data`, so your local database and image cache remain on disk unless you remove them yourself.

Holoshelf does not upload your local database to the project maintainers.
