#!/usr/bin/env python3
"""Download the browser libraries used by index.html for offline use."""

from pathlib import Path
from urllib.request import Request, urlopen


LIBRARIES = {
    "leaflet.css": "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    "leaflet.js": "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    "maplibre-gl.css": "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",
    "maplibre-gl.js": "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",
    "satellite.min.js": "https://cdn.jsdelivr.net/npm/satellite.js@6.0.1/dist/satellite.min.js",
    "gnss-api.js": (
        "https://cdn.jsdelivr.net/gh/christian-skjetne/PRN-to-skymap"
        "@83bfc7155df1d13ab84f9569e2764554ef76d110/gnss-api.js"
    ),
}


def main():
    folder = Path(__file__).resolve().parent
    for filename, url in LIBRARIES.items():
        destination = folder / filename
        temporary = destination.with_suffix(destination.suffix + ".part")
        try:
            request = Request(url, headers={"User-Agent": "ubxInsight offline library downloader"})
            with urlopen(request, timeout=30) as response, temporary.open("wb") as output:
                output.write(response.read())
            temporary.replace(destination)
            print(f"Saved {filename}")
        except Exception as error:
            temporary.unlink(missing_ok=True)
            raise SystemExit(f"Failed to download {filename}: {error}") from error


if __name__ == "__main__":
    main()
