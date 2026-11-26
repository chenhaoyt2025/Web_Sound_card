# GOHO Web Sound Card

A small, browser-based sound-card monitor for GOHO Web.

- Default input: **203 System Cardenza**, captured as one mono channel.
- Default output: the browser/system default device, in stereo.
- Optional output mode: mono.
- Input gain: 0–300%, applied in the Web Audio graph before the operating system output volume.
- Device scanning and selection for available audio inputs and outputs.
- Audio stays in the browser; the app does not upload microphone audio.

## Run

Open the GitHub Pages link over HTTPS in a current browser. Choose **Scan devices**, then **Enable sound card** and allow microphone access. Browsers hide device names until permission is granted, so the app requests permission before matching the preferred input. If **203 System Cardenza** is not connected, its preferred option remains disabled and another available input can be selected.

The browser must support microphone capture and `HTMLMediaElement.setSinkId()` to select a non-default output device. The system default output works without selecting a device. Input is requested with one channel; output defaults to stereo.
