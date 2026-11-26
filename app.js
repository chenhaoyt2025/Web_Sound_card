(() => {
  const PREFERRED_LABEL = "203 System Cardenza";
  const MISSING = "__preferred_missing__";
  const STORAGE_KEY = "goho-web-sound-card-settings-v1";
  const $ = (id) => document.getElementById(id);
  const inputSelect = $("inputDevice");
  const outputSelect = $("outputDevice");
  const outputMode = $("outputMode");
  const volumeSlider = $("volumeSlider");
  const state = {
    devices: [], inputStream: null, context: null, source: null, gain: null,
    analyser: null, merger: null, destination: null, audio: $("monitorAudio"),
    activeInputId: "", animFrame: 0, hasPermission: false, busy: false,
  };

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveSettings(patch) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readSettings(), ...patch })); }
    catch { /* Private browsing may disable storage; audio still works. */ }
  }
  function setStatus(message, tone = "idle") {
    $("statusText").textContent = message;
    $("statusLight").className = `status-light${tone === "active" ? " active" : tone === "warn" ? " warn" : ""}`;
    $("topState").textContent = tone === "active" ? "MONITORING" : tone === "warn" ? "CHECK DEVICE" : "READY";
    $("liveDot").className = `live-dot${tone === "active" ? " active" : tone === "warn" ? " warn" : ""}`;
  }
  function option(value, label, disabled = false) {
    const item = document.createElement("option");
    item.value = value; item.textContent = label; item.disabled = disabled;
    return item;
  }
  function isPreferred(device) {
    const label = (device.label || "").toLowerCase();
    return label.includes("203") && label.includes("cardenza");
  }
  function paintInputBadge(text, connected = false) {
    const badge = $("inputBadge");
    badge.className = `connection-state${connected ? " connected" : ""}`;
    badge.replaceChildren();
    const dot = document.createElement("span"); dot.className = "badge-dot";
    const copy = document.createElement("span"); copy.textContent = text;
    badge.append(dot, copy);
  }
  function renderInputs(devices) {
    const inputs = devices.filter((device) => device.kind === "audioinput");
    const labelsVisible = inputs.some((device) => device.label.trim());
    const settings = readSettings();
    const preferred = inputs.find(isPreferred);
    const oldChoice = inputSelect.value;
    const hadManualChoice = oldChoice && oldChoice !== MISSING;
    const savedId = hadManualChoice ? oldChoice : settings.inputId;
    const savedIsPresent = savedId && inputs.some((device) => device.deviceId === savedId);
    inputSelect.replaceChildren();

    if (!labelsVisible && !state.hasPermission) {
      inputSelect.append(option(MISSING, `${PREFERRED_LABEL} · 授权后扫描`, true));
      inputSelect.value = MISSING;
      inputSelect.disabled = true;
      paintInputBadge("等待授权");
      return { preferred: null, labelsVisible: false };
    }

    if (savedId && !savedIsPresent && savedId !== preferred?.deviceId) {
      inputSelect.append(option(savedId, "上次选择的输入设备 · 未连接", true));
    }
    if (!preferred) inputSelect.append(option(MISSING, `${PREFERRED_LABEL} · 未连接`, true));
    for (const [index, device] of inputs.entries()) {
      const label = device.label.trim() || `Audio input ${index + 1}`;
      inputSelect.append(option(device.deviceId, label));
    }
    if (!inputs.length) inputSelect.append(option("__no_input__", "未检测到输入设备", true));

    const desired = savedIsPresent ? savedId : preferred?.deviceId || MISSING;
    inputSelect.value = desired;
    if (inputSelect.value !== desired) inputSelect.value = MISSING;
    inputSelect.disabled = !inputs.length;
    if (preferred) paintInputBadge("已连接", true);
    else paintInputBadge("未连接");
    return { preferred, labelsVisible: true };
  }
  function renderOutputs(devices) {
    const outputs = devices.filter((device) => device.kind === "audiooutput" && device.deviceId && device.deviceId !== "default");
    const settings = readSettings();
    const oldChoice = outputSelect.value;
    const selected = oldChoice || settings.outputId || "";
    outputSelect.replaceChildren(option("", "系统默认输出设备"));
    const present = outputs.some((device) => device.deviceId === selected);
    if (selected && !present) outputSelect.append(option(selected, "上次选择的输出设备 · 未连接", true));
    for (const [index, device] of outputs.entries()) {
      outputSelect.append(option(device.deviceId, device.label.trim() || `Audio output ${index + 1}`));
    }
    outputSelect.value = selected && !present ? selected : selected;
  }
  async function scanDevices({ quiet = false } = {}) {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setStatus("当前浏览器不支持声卡扫描，请使用最新版 Chrome、Edge 或 Safari。", "warn");
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      state.devices = devices;
      const inputInfo = renderInputs(devices);
      renderOutputs(devices);
      if (state.activeInputId && !devices.some((device) => device.kind === "audioinput" && device.deviceId === state.activeInputId)) {
        await stopMonitoring({ message: `${PREFERRED_LABEL} 已断开，请重新扫描设备。` });
      } else if (!quiet && !inputInfo.labelsVisible) {
        setStatus("已扫描。浏览器隐藏了声卡名称，请点击「启用声卡」授权并匹配默认输入。", "warn");
      } else if (!quiet && !inputInfo.preferred) {
        setStatus(`${PREFERRED_LABEL} 未连接；可在输入列表选择其他设备。`, "warn");
      } else if (!quiet) {
        setStatus(`${PREFERRED_LABEL} 已就绪，输入为单声道；输出使用系统默认设备。`);
      }
    } catch (error) {
      setStatus(`扫描失败：${error.message || error}`, "warn");
    }
  }
  function updateGain() {
    const percent = Number(volumeSlider.value);
    $("volumeValue").textContent = String(percent);
    volumeSlider.style.setProperty("--level", `${percent / 3}%`);
    if (state.gain && state.context) state.gain.gain.setTargetAtTime(percent / 100, state.context.currentTime, 0.012);
    saveSettings({ volume: percent });
  }
  function updateOutputMode() {
    if (!state.context || !state.analyser || !state.destination) return;
    if (state.merger) { state.merger.disconnect(); state.merger = null; }
    state.analyser.disconnect();
    const channels = outputMode.value === "stereo" ? 2 : 1;
    state.destination.channelCount = channels;
    state.destination.channelCountMode = "explicit";
    const merger = state.context.createChannelMerger(channels);
    state.analyser.connect(merger, 0, 0);
    if (channels === 2) state.analyser.connect(merger, 0, 1);
    merger.connect(state.destination);
    state.merger = merger;
    saveSettings({ outputMode: outputMode.value });
  }
  async function setOutputDevice(deviceId) {
    saveSettings({ outputId: deviceId });
    if (!state.audio.srcObject || typeof state.audio.setSinkId !== "function") return;
    try {
      await state.audio.setSinkId(deviceId);
      setStatus(deviceId ? "输出设备已切换。" : "正在使用系统默认输出设备。", state.inputStream ? "active" : "idle");
    } catch (error) {
      setStatus(`无法切换输出设备：${error.message || error}`, "warn");
    }
  }
  async function chooseOutputDevice() {
    if (typeof navigator.mediaDevices?.selectAudioOutput !== "function") {
      setStatus("此浏览器不支持输出设备授权选择；可从已列出的设备中切换。", "warn");
      return;
    }
    try {
      const selected = await navigator.mediaDevices.selectAudioOutput();
      if (selected?.deviceId) {
        state.devices = [...state.devices.filter((device) => device.deviceId !== selected.deviceId), selected];
        renderOutputs(state.devices);
        outputSelect.value = selected.deviceId;
        await setOutputDevice(selected.deviceId);
        if (!state.inputStream) setStatus(`${selected.label || "输出设备"} 已选择。启用声卡后开始监听。`);
      }
    } catch (error) {
      if (error.name !== "NotAllowedError") setStatus(`无法选择输出设备：${error.message || error}`, "warn");
    }
  }
  function animateMeter() {
    cancelAnimationFrame(state.animFrame);
    if (!state.analyser) return;
    const samples = new Float32Array(state.analyser.fftSize);
    const draw = () => {
      if (!state.analyser) return;
      state.analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      const height = Math.min(100, Math.max(0, 20 * Math.log10(rms + 1e-5) + 100));
      $("meterLeft").style.height = `${height}%`;
      $("meterRight").style.height = `${height}%`;
      state.animFrame = requestAnimationFrame(draw);
    };
    draw();
  }
  async function connectInput(deviceId) {
    if (!deviceId || deviceId === MISSING || deviceId === "__no_input__") {
      throw new Error(`${PREFERRED_LABEL} 未连接。请选择一个已连接的输入设备。`);
    }
    if (state.inputStream) {
      state.inputStream.getTracks().forEach((track) => track.stop());
      state.inputStream = null;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        channelCount: { exact: 1 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    state.inputStream = stream;
    state.activeInputId = deviceId;
    const track = stream.getAudioTracks()[0];
    track.addEventListener("ended", () => {
      if (state.inputStream === stream) stopMonitoring({ message: "输入设备已断开。" });
    }, { once: true });
    state.source = state.context.createMediaStreamSource(stream);
    state.gain = state.context.createGain();
    state.gain.gain.value = Number(volumeSlider.value) / 100;
    state.analyser = state.context.createAnalyser();
    state.analyser.fftSize = 512;
    state.destination = state.context.createMediaStreamDestination();
    state.source.connect(state.gain);
    state.gain.connect(state.analyser);
    updateOutputMode();
    state.audio.srcObject = state.destination.stream;
    const selectedOutput = outputSelect.value;
    if (typeof state.audio.setSinkId === "function") await state.audio.setSinkId(selectedOutput);
    else if (selectedOutput) throw new Error("此浏览器不支持选择输出设备，请使用系统默认输出或更新浏览器。");
    await state.audio.play();
    const settings = track.getSettings();
    const rate = settings.sampleRate ? ` · ${settings.sampleRate} Hz` : "";
    $("startLabel").textContent = "停止监听";
    $("startButton").classList.add("running");
    $("permissionNote").textContent = `监听已启用 · MONO${rate} · 音频仅在本机处理`;
    paintInputBadge("监听中", true);
    setStatus(`${track.label || PREFERRED_LABEL} 正在单声道监听。`, "active");
    animateMeter();
  }
  function cleanupGraph() {
    cancelAnimationFrame(state.animFrame);
    state.animFrame = 0;
    for (const node of [state.source, state.gain, state.analyser, state.merger]) {
      try { node?.disconnect(); } catch { /* Already disconnected. */ }
    }
    state.source = state.gain = state.analyser = state.merger = state.destination = null;
    state.activeInputId = "";
    state.audio.pause();
    state.audio.srcObject = null;
    $("meterLeft").style.height = "0";
    $("meterRight").style.height = "0";
  }
  async function stopMonitoring({ message = "监听已停止。" } = {}) {
    cleanupGraph();
    if (state.inputStream) state.inputStream.getTracks().forEach((track) => track.stop());
    state.inputStream = null;
    if (state.context) {
      const context = state.context;
      state.context = null;
      try { await context.close(); } catch { /* Context may already be closed. */ }
    }
    $("startLabel").textContent = "启用声卡";
    $("startButton").classList.remove("running");
    $("permissionNote").textContent = "点击启用以授权麦克风并开始监听。音频处理在浏览器本地完成。";
    paintInputBadge("等待启用");
    setStatus(message, "idle");
  }
  async function startMonitoring() {
    if (state.busy) return;
    if (state.inputStream) { await stopMonitoring(); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("请通过 HTTPS 打开页面，并允许浏览器使用麦克风。", "warn");
      return;
    }
    if (!window.isSecureContext) {
      setStatus("麦克风需要 HTTPS 安全连接。", "warn");
      return;
    }
    state.busy = true;
    $("startButton").disabled = true;
    $("scanButton").disabled = true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio。");
      state.context = new AudioContextClass({ latencyHint: "interactive" });
      await state.context.resume();
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      permissionStream.getTracks().forEach((track) => track.stop());
      state.hasPermission = true;
      await scanDevices({ quiet: true });
      const preferred = state.devices.find((device) => device.kind === "audioinput" && isPreferred(device));
      const currentSelection = inputSelect.value;
      const selectedIsUsable = state.devices.some((device) => device.kind === "audioinput" && device.deviceId === currentSelection);
      if (preferred && !readSettings().inputId) inputSelect.value = preferred.deviceId;
      const selectedId = selectedIsUsable ? currentSelection : preferred?.deviceId || currentSelection;
      if (!preferred && (selectedId === MISSING || !state.devices.some((device) => device.kind === "audioinput" && device.deviceId === selectedId))) {
        throw new Error(`${PREFERRED_LABEL} 未连接。连接后重新扫描，或选择其他已连接输入。`);
      }
      inputSelect.value = selectedId;
      saveSettings({ inputId: selectedId });
      await connectInput(selectedId);
    } catch (error) {
      await stopMonitoring({ message: error.name === "NotAllowedError" ? "麦克风权限未授予。请在浏览器地址栏允许麦克风后重试。" : `无法启用声卡：${error.message || error}` });
      await scanDevices({ quiet: true });
    } finally {
      state.busy = false;
      $("startButton").disabled = false;
      $("scanButton").disabled = false;
    }
  }
  inputSelect.addEventListener("change", async () => {
    saveSettings({ inputId: inputSelect.value });
    if (state.inputStream) {
      state.busy = true; $("startButton").disabled = true;
      try { await connectInput(inputSelect.value); }
      catch (error) { await stopMonitoring({ message: `输入切换失败：${error.message || error}` }); }
      finally { state.busy = false; $("startButton").disabled = false; }
    }
  });
  outputSelect.addEventListener("change", () => setOutputDevice(outputSelect.value));
  $("chooseOutputButton").addEventListener("click", chooseOutputDevice);
  outputMode.addEventListener("change", updateOutputMode);
  volumeSlider.addEventListener("input", updateGain);
  $("scanButton").addEventListener("click", () => scanDevices());
  $("startButton").addEventListener("click", startMonitoring);
  navigator.mediaDevices?.addEventListener?.("devicechange", () => scanDevices({ quiet: true }));

  const settings = readSettings();
  if (Number.isFinite(settings.volume)) volumeSlider.value = String(Math.max(0, Math.min(300, settings.volume)));
  if (settings.outputMode === "mono" || settings.outputMode === "stereo") outputMode.value = settings.outputMode;
  updateGain();
  scanDevices();
})();
