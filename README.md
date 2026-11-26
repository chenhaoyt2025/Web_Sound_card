# GOHO Web Sound Card

A small, browser-based sound-card monitor for GOHO Web.

- Default input: **203 System Cardenza**. The app reads the selected input's reported channel count and defaults to mono for a one-channel input or stereo channels 1–2 when at least two channels are available.
- Default output: the browser/system default device, in stereo.
- Optional output mode: mono.
- Input gain: 0–300%, applied in the Web Audio graph before the operating system output volume.
- Independent device scanning and selection for available audio inputs and outputs. Scanning requests microphone permission when needed, reads the selected input's channel information, and immediately releases its temporary stream without starting monitoring.
- Per-channel mono selection and adjacent stereo-pair selection for multichannel inputs.
- Browser-tab audio capture as an alternate input source.
- A browser audio-output picker for devices hidden until the user grants speaker access.
- Audio stays in the browser; the app does not upload microphone audio.

## Run

Open the GitHub Pages link over HTTPS in a current browser. **Scan devices** is independent from **Enable sound card**: scanning may request microphone permission so the browser can reveal device names and channel information, then releases the temporary stream. It does not start audio output. Choose **Enable sound card** only when you want monitoring to begin. If **203 System Cardenza** is not connected, its preferred option remains disabled and another available input can be selected.

For browser-tab audio, choose **Browser tab audio** and then select a tab and enable its audio in the browser's share picker. Browser support and the ability to share tab audio vary. The browser must support microphone capture and `HTMLMediaElement.setSinkId()` to select a non-default output device. The system default output works without selecting a device. Output defaults to stereo.
