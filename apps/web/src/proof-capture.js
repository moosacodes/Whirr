import { MicrophoneEngine } from '/src/lib/audio.ts';

      const $ = (id) => document.getElementById(id);
      const objectId = new URLSearchParams(location.search).get('objectId');
      const state = {
        phase: 'ready',
        done: false,
        error: null,
        objectId,
        deviceLabel: null,
        takes: [],
        frames: 0,
      };
      window.__whirrProof = state;

      const log = (message, tone = '') => {
        const line = document.createElement('div');
        if (tone) line.className = tone;
        line.textContent = message;
        $('log').appendChild(line);
        $('log').scrollTop = $('log').scrollHeight;
      };

      const setPhase = (phase) => {
        state.phase = phase;
        const labels = {
          preparing: 'Preparing microphone',
          ready: 'Get ready',
          recording: 'Recording',
          uploading: 'Uploading features',
          complete: 'Complete',
          error: 'Error',
        };
        $('phasePill').textContent = labels[phase] ?? phase;
        $('phasePill').className = `pill ${phase === 'recording' ? 'warn' : phase === 'complete' ? 'ok' : ''}`;
      };

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const setInstruction = (title, detail, stepNo) => {
        if (stepNo) $('stepNo').textContent = stepNo;
        $('instruction').textContent = title;
        $('detail').textContent = detail;
      };

      const setCount = (value) => {
        $('count').textContent = value;
      };

      const setProgress = (fraction) => {
        $('progress').style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
      };

      const setLevel = (rms) => {
        const normalized = Math.min(1, Math.max(0, (Math.log10(Math.max(rms, 1e-9)) + 4) / 3));
        $('levelBar').style.width = `${normalized * 100}%`;
        $('levelText').textContent = rms.toFixed(6);
      };

      const showError = (error) => {
        const message = error instanceof Error ? error.message : String(error);
        state.error = message;
        state.phase = 'error';
        setPhase('error');
        setInstruction('Capture error', message, 'Stopped');
        setCount('!');
        log(message, 'error');
        $('hint').textContent = 'The proof did not continue. Tell the operator what the window says.';
      };

      const takeConfig = [
        {
          label: 'idle',
          title: 'FAN OFF · quiet room',
          detail: 'Switch the fan off. Let it stop completely. Stay quiet while it records.',
          prep: 'Fan off now. Let the blades stop.',
          note: 'Take 1 — idle / room, fan off',
        },
        {
          label: 'active',
          title: 'FAN ON · high',
          detail: 'Turn the fan on high now. Keep it running through the whole take.',
          prep: 'Turn the fan ON high now.',
          note: 'Take 2 — active / fan on high',
        },
        {
          label: 'idle',
          title: 'FAN OFF · quiet room',
          detail: 'Switch the fan off. Let it stop completely. Stay quiet while it records.',
          prep: 'Fan off now. Let the blades stop.',
          note: 'Take 3 — idle / room, fan off',
        },
        {
          label: 'active',
          title: 'FAN ON · high',
          detail: 'Turn the fan on high now. Keep it running through the whole take.',
          prep: 'Turn the fan ON high now.',
          note: 'Take 4 — active / fan on high',
        },
        {
          label: 'negative',
          title: 'FAN OFF · different sound',
          detail: 'Fan off. Say a sentence, tap the desk, or make another ordinary sound. Do not turn the fan on.',
          prep: 'Fan off. Talk or tap the desk during the take.',
          note: 'Take 5 — negative / voice or desk tap, fan off',
        },
        {
          label: 'negative',
          title: 'FAN OFF · another sound',
          detail: 'Fan off. Make a second, different non-fan sound — talk, clap, or move something nearby.',
          prep: 'Fan off. Make a different sound during the take.',
          note: 'Take 6 — negative / second non-fan sound, fan off',
        },
      ];

      const PREP_MS = 6500;
      const RECORD_MS = 12000;
      const BETWEEN_MS = 3500;

      async function chooseDevice() {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: { ideal: 1 },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });
        const track = stream.getAudioTracks()[0];
        const deviceLabel = track?.label || 'Default microphone';
        const devices = await navigator.mediaDevices.enumerateDevices();
        const jack = devices.find((device) => device.kind === 'audioinput' && /jack mic/i.test(device.label));
        stream.getTracks().forEach((item) => item.stop());
        state.deviceLabel = deviceLabel;
        $('devicePill').textContent = `Microphone: ${deviceLabel}`;
        $('devicePill').className = 'pill ok';
        return jack?.deviceId;
      }

      async function uploadTake(take, frames, durationMs) {
        const response = await fetch(`/api/operator/objects/${objectId}/takes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-whirr-csrf': '1',
            Accept: 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            label: take.label,
            frames: frames.map((frame) => frame.features),
            frameFlags: frames.map((frame) => frame.flags),
            durationMs: Math.max(500, Math.min(120000, Math.round(durationMs))),
            source: 'live',
            deviceLabel: state.deviceLabel,
            notes: take.note,
            featureSpecVersion: 'whirr-features-v1',
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error?.message ?? `Upload failed (${response.status})`);
        }
        return body.take;
      }

      async function recordTake(take, index, deviceId) {
        $('takePill').textContent = `Take ${index + 1} / ${takeConfig.length}`;
        setPhase('ready');
        setInstruction(take.prep, 'The recording starts when the count reaches zero.', `Take ${index + 1} of ${takeConfig.length} · get ready`);
        for (let remaining = Math.ceil(PREP_MS / 1000); remaining > 0; remaining -= 1) {
          setCount(String(remaining));
          setProgress((PREP_MS / 1000 - remaining + 1) / (PREP_MS / 1000));
          await sleep(1000);
        }

        setPhase('recording');
        setInstruction(take.title, take.detail, `Take ${index + 1} of ${takeConfig.length} · recording`);
        setCount(String(Math.ceil(RECORD_MS / 1000)));
        setProgress(0);
        const frames = [];
        const started = performance.now();
        const engine = new MicrophoneEngine({
          onFrame: (frame) => {
            frames.push(frame);
            state.frames = frames.length;
          },
          onLevel: setLevel,
          onError: (message) => log(message, 'error'),
        });
        try {
          await engine.start(deviceId);
          const startedAt = performance.now();
          const timer = setInterval(() => {
            const elapsed = performance.now() - startedAt;
            const remaining = Math.max(0, RECORD_MS - elapsed);
            setCount(String(Math.ceil(remaining / 1000)));
            setProgress(elapsed / RECORD_MS);
          }, 100);
          await sleep(RECORD_MS + 500);
          clearInterval(timer);
          await engine.stop();
        } catch (error) {
          await engine.stop();
          throw error;
        }
        const durationMs = Math.max(
          RECORD_MS,
          frames.length ? frames[frames.length - 1].endMs : performance.now() - started,
        );
        if (frames.length < 30) {
          throw new Error(`Take ${index + 1} produced only ${frames.length} frames; the microphone did not deliver audio.`);
        }
        setPhase('uploading');
        setInstruction('Uploading features', `${frames.length} frames extracted on this device. No raw audio leaves this browser.`, `Take ${index + 1} of ${takeConfig.length}`);
        const uploaded = await uploadTake(take, frames, durationMs);
        state.takes.push({
          id: uploaded.id,
          label: uploaded.label,
          frames: uploaded.frameCount,
          durationMs: uploaded.durationMs,
          quality: uploaded.quality,
          note: take.note,
        });
        log(
          `Take ${index + 1} · ${take.label} · ${(uploaded.durationMs / 1000).toFixed(1)}s · ${uploaded.frameCount} frames · clipped ${(uploaded.quality.clippedRatio * 100).toFixed(0)}%`,
          'complete',
        );
        setPhase('ready');
        setCount('✓');
        setProgress(1);
        await sleep(BETWEEN_MS);
      }

      async function run() {
        if (!objectId) throw new Error('No objectId was supplied to the capture window.');
        $('begin').disabled = true;
        $('begin').classList.add('hidden');
        $('run').classList.remove('hidden');
        setPhase('preparing');
        setInstruction('Preparing microphone', 'Allow the microphone if the browser asks. This uses the Jack Mic.', 'Stand by');
        setCount('…');
        log(`Object: ${objectId}`);
        const deviceId = await chooseDevice();
        log(`Input: ${state.deviceLabel}`);
        for (let index = 0; index < takeConfig.length; index += 1) {
          await recordTake(takeConfig[index], index, deviceId);
        }
        setPhase('complete');
        state.done = true;
        $('run').classList.add('hidden');
        $('finished').classList.remove('hidden');
        $('summary').textContent =
          `${state.takes.length} takes uploaded from ${state.deviceLabel}. The operator can now train the model.`;
        $('resultLog').replaceChildren(
          ...state.takes.map((take, index) => {
            const row = document.createElement('div');
            const label = document.createElement('b');
            label.textContent = `${index + 1}. ${take.label}`;
            row.append(
              label,
              document.createTextNode(
                ` · ${(take.durationMs / 1000).toFixed(1)}s · ${take.frames} frames · clipped ${(take.quality.clippedRatio * 100).toFixed(0)}%`,
              ),
            );
            return row;
          }),
        );
        log('All six takes uploaded. Do not close this window yet.', 'complete');
      }

      $('begin').addEventListener('click', () => {
        run().catch(showError);
      });

      window.addEventListener('error', (event) => {
        if (!state.done) showError(event.error ?? event.message);
      });
      window.addEventListener('unhandledrejection', (event) => {
        if (!state.done) showError(event.reason);
      });
