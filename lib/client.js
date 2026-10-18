/**
 * DSH 健康钟插件 —— 浏览器半边（Client half）
 * ============================================================================
 *
 * 第 3 轮改判：计时不再放在浏览器里，而是由宿主（lib/index.js）负责。
 * 原因：DSH 最小化到托盘后，隐藏窗口里的定时器会被 Chromium 节流，弹窗也画在
 * 看不见的窗口里 —— 用户看到的现象就是「完全没弹窗」。
 *
 * 现在的分工：
 *   · 宿主：计时、切状态、到点用 PowerShell 把窗口叫回前台；
 *   · 浏览器：每秒拉一次状态，画悬浮卡片 / 左下角入口 / 详情面板，播放提示音。
 *
 * 页面刷新不会丢进度（状态在宿主内存里）；彻底重启 DSH 才重新开始。
 */

window.__ModuleLoader__.load({
  id: 'dsh-clock',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');

    // ── 常量 ────────────────────────────────────────────────────────────────
    /** 与宿主 lib/index.js 的 API_PREFIX 必须一致。 */
    const API = '/dsh-clock/rpc';

    /** 客户端版本标记。改本文件时 +1，便于确认浏览器里跑的是新包。 */
    const CLIENT_VERSION = '1.1.0';

    /** 样式表元素 id，卸载时按它清理。 */
    const STYLE_ID = 'dsh-clock-style';

    /** 模块级单例挂在 window 上的键（热更新时清掉旧实例）。 */
    const STORE_KEY = '__dshClockStore__';

    /** 长按紧急跳过需要的时长。 */
    const SKIP_HOLD_MS = 3000;

    /** 拉状态的间隔（毫秒）。倒计时的秒数在本地走，不需要每次拉。 */
    const POLL_MS = 2000;

    /**
     * 「更多功能」的预留入口。
     * 第 3 轮先占位，后面往里加功能时：在这里加一条 + 写对应的面板/弹窗即可。
     */
    const FUTURE_FEATURES = [
      { id: 'stats', icon: '📊', label: '统计与连续天数', hint: '即将上线' },
      { id: 'custom', icon: '🧩', label: '自定义休息计划', hint: '即将上线' },
      { id: 'sound', icon: '🔔', label: '提示音与音量', hint: '即将上线' }
    ];

    // ── 提示音 ──────────────────────────────────────────────────────────────
    // Web Audio 不需要授权；但浏览器自动播放策略要求「用户先和页面交互过」，
    // 所以在每次 pointerdown 时顺手解锁一次 AudioContext。
    let audioCtx = null;

    function unlockAudio() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!audioCtx) audioCtx = new AC();
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      } catch {
        /* 没有音频能力就算了 */
      }
    }

    function tone(freq, startAt, duration) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.22, startAt + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration + 0.05);
    }

    function playChime() {
      unlockAudio();
      if (!audioCtx || audioCtx.state !== 'running') return;
      const t0 = audioCtx.currentTime + 0.05;
      const seq = [
        [523.25, 0], [783.99, 0.18],
        [523.25, 1.6], [783.99, 1.78],
        [659.25, 3.2], [880.0, 3.38]
      ];
      for (const [freq, offset] of seq) {
        try {
          tone(freq, t0 + offset, 0.5);
        } catch {
          /* 单个音失败不影响其余 */
        }
      }
    }

    // ── 小工具 ──────────────────────────────────────────────────────────────
    function formatMs(ms) {
      const total = Math.max(0, Math.ceil(ms / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function formatClock(ts) {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function phaseLabel(phase) {
      if (phase === 'rest') return '休息中';
      if (phase === 'done') return '休息结束';
      return '工作中';
    }

    /** 把计划时间线按实际休息时长缩放（准备 10 秒保持不变，动作节奏按比例变）。 */
    function buildPlanTimeline(plan, restSeconds) {
      const prepareSeconds = Math.max(3, Number(plan?.prepareSeconds) || 10);
      const baseTotal = Math.max(prepareSeconds + 1, Number(plan?.totalSeconds) || 0);
      const bodyBase = Math.max(1, baseTotal - prepareSeconds);
      const target = Math.max(prepareSeconds + 20, Number(restSeconds) || baseTotal);
      const scale = Math.max(0.05, (target - prepareSeconds) / bodyBase);
      const steps = (plan?.steps ?? []).map((step) => ({
        ...step,
        duration: Math.max(1, step.seconds * scale)
      }));
      return {
        prepareSeconds,
        steps,
        total: prepareSeconds + steps.reduce((sum, step) => sum + step.duration, 0),
        scale
      };
    }

    /** 当前时间线位置：prepare / step / finished。 */
    function locateTimeline(timeline, elapsedSeconds) {
      const t = Math.max(0, elapsedSeconds);
      if (t < timeline.prepareSeconds) {
        return {
          mode: 'prepare',
          index: -1,
          remaining: timeline.prepareSeconds - t,
          progress: timeline.prepareSeconds > 0 ? t / timeline.prepareSeconds : 1
        };
      }
      let cursor = t - timeline.prepareSeconds;
      for (let index = 0; index < timeline.steps.length; index += 1) {
        const step = timeline.steps[index];
        if (cursor < step.duration) {
          return {
            mode: 'step',
            index,
            step,
            remaining: step.duration - cursor,
            progress: step.duration > 0 ? cursor / step.duration : 1
          };
        }
        cursor -= step.duration;
      }
      return { mode: 'finished', index: timeline.steps.length, remaining: 0, progress: 1 };
    }

    /** 请求宿主 API。失败抛错，由调用方决定怎么提示。 */
    async function request(path, init) {
      const res = await fetch(API + path, { cache: 'no-store', ...init });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data || data.ok !== true) {
        const message = data && data.error ? data.error : `HTTP ${res.status}`;
        throw new Error(message);
      }
      return data;
    }

    // ── 计时仓库（只镜像宿主状态）────────────────────────────────────────────
    function createClockStore() {
      const prev = window[STORE_KEY];
      if (prev) {
        try {
          prev.dispose();
        } catch {
          /* 旧实例清理失败也要继续 */
        }
      }

      let snapshot = {
        state: null,
        now: Date.now(),
        offset: 0,
        connected: false,
        error: null
      };
      const listeners = new Set();
      let pollTimer = null;
      let tickTimer = null;
      let disposed = false;
      let lastPhase = null;
      let flashTimer = null;
      let flashBase = '';

      function emit() {
        snapshot = { ...snapshot, now: Date.now() + snapshot.offset };
        for (const listener of listeners) {
          try {
            listener();
          } catch {
            /* 一个订阅者出错不拖累其它 */
          }
        }
      }

      /** 窗口标题闪烁，把最小化的用户叫回来（任务栏原生闪烁插件做不到）。 */
      function startFlash() {
        if (flashTimer !== null || typeof document === 'undefined') return;
        flashBase = document.title;
        let flip = false;
        flashTimer = setInterval(() => {
          flip = !flip;
          document.title = flip ? '🐣 起来动一动！' : flashBase;
        }, 1000);
      }

      function stopFlash() {
        if (flashTimer !== null) {
          clearInterval(flashTimer);
          flashTimer = null;
        }
        if (typeof document !== 'undefined' && document.title.startsWith('🐣')) {
          document.title = flashBase;
        }
      }

      /** 把宿主返回的状态装进快照。 */
      function applyState(state, serverNow) {
        if (!state) return;
        if (typeof serverNow === 'number') snapshot.offset = serverNow - Date.now();
        const prevPhase = lastPhase;
        snapshot.state = state;
        snapshot.connected = true;
        snapshot.error = null;

        if (prevPhase !== null && prevPhase !== state.phase) {
          if (state.phase === 'rest') {
            playChime();
            // 窗口已经被宿主叫到前台时不用再闪标题；只在没有焦点时闪。
            if (typeof document === 'undefined' || !document.hasFocus()) startFlash();
          } else if (state.phase === 'done' || state.phase === 'work') {
            stopFlash();
          }
        }
        lastPhase = state.phase;
        emit();
      }

      async function refresh() {
        if (disposed) return;
        try {
          const data = await request('/state');
          if (disposed) return;
          applyState(data.state, data.state?.now);
        } catch (error) {
          if (disposed) return;
          snapshot.connected = false;
          snapshot.error = String(error?.message ?? error);
          emit();
        }
      }

      async function post(path) {
        try {
          const data = await request(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}'
          });
          if (data.state) applyState(data.state, data.state.now);
          return data;
        } catch (error) {
          snapshot.connected = false;
          snapshot.error = String(error?.message ?? error);
          emit();
          return null;
        }
      }

      function onVisibility() {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          stopFlash();
          refresh();
        }
      }

      function onFocus() {
        stopFlash();
        refresh();
      }

      const store = {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot() {
          return snapshot;
        },
        refresh,
        start() {
          if (pollTimer !== null) return;
          pollTimer = setInterval(refresh, POLL_MS);
          tickTimer = setInterval(emit, 1000);
          if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibility);
            document.addEventListener('pointerdown', unlockAudio);
          }
          if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
          refresh();
        },
        dispose() {
          disposed = true;
          if (pollTimer !== null) clearInterval(pollTimer);
          if (tickTimer !== null) clearInterval(tickTimer);
          pollTimer = null;
          tickTimer = null;
          stopFlash();
          if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisibility);
            document.removeEventListener('pointerdown', unlockAudio);
          }
          if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
          listeners.clear();
          if (window[STORE_KEY] === store) delete window[STORE_KEY];
        },
        startRestNow: () => post('/rest'),
        skipRest: () => post('/skip'),
        startNextRound: () => post('/next'),
        reset: () => post('/reset'),
        testWake: () => post('/wake')
      };

      window[STORE_KEY] = store;
      return store;
    }

    /** 当前仓库（apply 里创建；组件渲染时它一定已存在）。 */
    let store = null;

    function useClock() {
      if (!store) return null;
      return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    }

    // ── 样式 ────────────────────────────────────────────────────────────────
    function clockCss() {
      return [
        // 幕布：盖住整个 DSH 窗口，后面的东西点不到
        '.dsh-clock-backdrop{position:fixed;inset:0;z-index:1000;display:flex;',
        'align-items:center;justify-content:center;padding:24px;',
        'background:rgba(24,18,10,.55);backdrop-filter:blur(2px);}',

        // 卡片：软糖质感
        '.dsh-clock-card{box-sizing:border-box;display:flex;flex-direction:column;',
        'align-items:center;gap:14px;width:100%;max-width:500px;padding:34px 36px 26px;',
        'max-height:calc(100vh - 48px);overflow:auto;',
        'background:#fff6e5;border:3px solid #ffd9a0;border-radius:24px;',
        'box-shadow:0 18px 60px rgba(120,60,0,.35);color:#5b3a1a;text-align:center;}',

        '@keyframes dsh-clock-pop{0%{transform:scale(.6);opacity:0}',
        '70%{transform:scale(1.05);opacity:1}100%{transform:scale(1)}}',
        '.dsh-clock-pop{animation:dsh-clock-pop .45s cubic-bezier(.34,1.56,.64,1) both;}',

        '@keyframes dsh-clock-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}',
        '.dsh-clock-chick{font-size:56px;line-height:1;animation:dsh-clock-bounce 1.6s ease-in-out infinite;}',

        '.dsh-clock-title{font-size:28px;font-weight:700;letter-spacing:.04em;color:#d9601a;}',
        '.dsh-clock-task{font-size:34px;font-weight:700;color:#8a4b12;}',
        '.dsh-clock-detail{font-size:17px;line-height:26px;color:#9a6a33;}',

        '.dsh-clock-count{font-size:56px;font-weight:800;font-variant-numeric:tabular-nums;',
        'letter-spacing:.03em;color:#d9601a;}',
        '@keyframes dsh-clock-heart{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}',
        '.dsh-clock-count-urgent{color:#e23b2e;animation:dsh-clock-heart 1s ease-in-out infinite;}',

        '.dsh-clock-bar{box-sizing:border-box;width:100%;height:14px;border-radius:999px;',
        'background:#f3e2c2;border:1.5px solid #ffd9a0;overflow:hidden;}',
        '.dsh-clock-bar-fill{height:100%;border-radius:999px;',
        'background:linear-gradient(90deg,#ffb35c,#ff8a5c);transition:width .5s linear;}',
        '.dsh-clock-pct{font-size:13px;color:#b3854d;}',

        '.dsh-clock-done-btn{font:inherit;font-size:19px;font-weight:700;cursor:pointer;',
        'padding:12px 34px;border:0;border-radius:999px;color:#fff;',
        'background:linear-gradient(135deg,#ff9a4d,#f06a8a);',
        'box-shadow:0 6px 18px rgba(240,106,90,.4);}',
        '.dsh-clock-done-btn:hover{filter:brightness(1.06);}',
        '.dsh-clock-done-btn:disabled{cursor:not-allowed;filter:grayscale(.6);opacity:.55;',
        'box-shadow:none;}',

        '.dsh-clock-skip{position:relative;font:inherit;font-size:12.5px;cursor:pointer;',
        'padding:7px 16px;border-radius:999px;color:#b3854d;background:0 0;',
        'border:1.5px dashed #e3c491;overflow:hidden;user-select:none;',
        '-webkit-user-select:none;touch-action:none;}',
        '.dsh-clock-skip-fill{position:absolute;inset:0;background:rgba(240,106,90,.25);',
        'transform-origin:left center;pointer-events:none;}',
        '.dsh-clock-skip-label{position:relative;}',
        '.dsh-clock-kaomoji{font-size:13px;color:#c99a5b;}',

        // 左下角入口
        '.dsh-clock-open{box-sizing:border-box;display:flex;align-items:center;gap:8px;',
        'height:42px;width:calc(100% + 4px);margin:0 -2px;padding:0 10px 0 8px;',
        'font-family:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden;',
        'color:var(--dsw-alias-label-primary);background:0 0;border:0;',
        'border-radius:12px;text-align:left;}',
        '.dsh-clock-open:hover{background:var(--dsw-alias-interactive-bg-hover);}',
        '.dsh-clock-open[data-open="true"]{background:var(--dsw-alias-interactive-bg-hover);}',
        '.dsh-clock-open-rail{width:36px;height:36px;margin:0;padding:0;gap:0;flex:none;',
        'border-radius:50%;justify-content:center;}',
        '.dsh-clock-open-icon{flex:none;font-size:17px;line-height:1;}',
        '.dsh-clock-open-label{flex:1;min-width:0;overflow:hidden;white-space:nowrap;',
        'text-overflow:ellipsis;font-variant-numeric:tabular-nums;}',
        '.dsh-clock-open[data-offline="true"] .dsh-clock-open-label{color:#c0392b;}',

        // 详情面板
        '.dsh-clock-panel{position:fixed;left:12px;bottom:64px;width:312px;',
        'max-width:calc(100vw - 24px);z-index:1200;box-sizing:border-box;padding:16px;',
        'border-radius:18px;background:#fff6e5;border:2px solid #ffd9a0;',
        'box-shadow:0 18px 50px rgba(120,60,0,.35);color:#5b3a1a;font-size:14px;',
        'line-height:1.5;}',
        '.dsh-clock-panel-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}',
        '.dsh-clock-panel-title{font-size:16px;font-weight:800;color:#d9601a;flex:1;}',
        '.dsh-clock-panel-close{border:0;background:0 0;font-size:18px;line-height:1;',
        'cursor:pointer;color:#b3854d;padding:2px 6px;border-radius:8px;}',
        '.dsh-clock-panel-close:hover{background:rgba(255,217,160,.5);}',
        '.dsh-clock-panel-big{font-size:34px;font-weight:800;font-variant-numeric:tabular-nums;',
        'color:#d9601a;text-align:center;margin:2px 0 6px;}',
        '.dsh-clock-panel-row{display:flex;justify-content:space-between;gap:10px;',
        'font-size:13px;color:#8a6238;margin:3px 0;}',
        '.dsh-clock-panel-row b{font-weight:700;color:#6b451f;}',
        '.dsh-clock-panel-sep{height:1px;background:#f0d9b5;margin:12px 0;}',
        '.dsh-clock-panel-actions{display:flex;gap:8px;flex-wrap:wrap;}',
        '.dsh-clock-panel-btn{font:inherit;font-size:13px;font-weight:700;cursor:pointer;',
        'padding:8px 14px;border-radius:999px;border:0;color:#fff;',
        'background:linear-gradient(135deg,#ff9a4d,#f06a8a);}',
        '.dsh-clock-panel-btn.ghost{background:#fff;border:1.5px solid #ffd9a0;color:#a8601f;}',
        '.dsh-clock-panel-btn:disabled{opacity:.5;cursor:default;}',
        '.dsh-clock-panel-note{font-size:11.5px;color:#b3854d;margin-top:8px;}',
        '.dsh-clock-future{display:flex;flex-direction:column;gap:4px;}',
        '.dsh-clock-future-item{display:flex;align-items:center;gap:8px;width:100%;',
        'border:0;font:inherit;text-align:left;cursor:pointer;',
        'padding:6px 8px;border-radius:10px;background:rgba(255,217,160,.25);',
        'color:#a07340;font-size:12.5px;}',
        '.dsh-clock-future-item:hover{background:rgba(255,217,160,.45);}',
        '.dsh-clock-future-item em{margin-left:auto;font-style:normal;opacity:.7;}',

        // 引导卡片（准备 → 步骤 → 完成）
        '.dsh-clock-summary{font-size:15px;line-height:23px;color:#9a6a33;max-width:100%;}',
        '.dsh-clock-prepare-num{font-size:96px;font-weight:900;line-height:1;color:#e23b2e;',
        'font-variant-numeric:tabular-nums;text-shadow:0 4px 0 rgba(255,180,90,.25);}',
        '.dsh-clock-prepare-hint{font-size:16px;font-weight:700;color:#8a4b12;}',
        '.dsh-clock-planline{font-size:12.5px;color:#b3854d;text-align:center;}',
        '.dsh-clock-step-badge{font-size:13px;color:#b3854d;letter-spacing:.02em;}',
        '.dsh-clock-step-name{font-size:30px;font-weight:800;color:#8a4b12;line-height:1.15;}',
        '.dsh-clock-step-cue{font-size:15px;line-height:23px;color:#9a6a33;max-width:100%;}',
        '.dsh-clock-step-count{font-size:76px;font-weight:900;line-height:1;color:#d9601a;',
        'font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:6px;}',
        '.dsh-clock-step-unit{font-size:22px;font-weight:700;color:#9a6a33;}',
        '.dsh-clock-next{font-size:13px;color:#b3854d;}',
        '.dsh-clock-dots{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-width:100%;padding:2px 0;}',
        '.dsh-clock-dot{width:8px;height:8px;border-radius:50%;background:#f0d9b5;transition:all .2s;}',
        '.dsh-clock-dot.is-done{background:#ffb35c;}',
        '.dsh-clock-dot.is-on{background:#e23b2e;transform:scale(1.6);}',
        '.dsh-clock-overall{width:100%;margin-top:2px;}',
        '.dsh-clock-overall-row{display:flex;justify-content:space-between;font-size:12.5px;',
        'color:#b3854d;margin-bottom:4px;font-variant-numeric:tabular-nums;}',
        '.dsh-clock-urgent{color:#e23b2e;}',

        // 设置页
        '.dsh-clock-settings{max-width:720px;padding:8px 4px 40px;',
        'color:var(--dsw-alias-label-primary,#3b2a1a);font-size:14px;line-height:1.65;}',
        '.dsh-clock-settings h2{font-size:21px;margin:0 0 4px;}',
        '.dsh-clock-settings h3{font-size:16px;margin:0 0 10px;}',
        '.dsh-clock-settings-sub{font-size:13px;color:var(--dsw-alias-label-secondary,#8a7a66);margin-bottom:16px;}',
        '.dsh-clock-settings-card{border:1px solid rgba(255,180,90,.35);',
        'background:rgba(255,217,160,.12);border-radius:16px;padding:16px 18px;margin-bottom:16px;}',
        '.dsh-clock-settings-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0;}',
        '.dsh-clock-settings-label{min-width:84px;font-weight:700;}',
        '.dsh-clock-settings-input{width:96px;font:inherit;padding:7px 10px;border-radius:10px;',
        'border:1.5px solid #ffd9a0;background:var(--dsw-alias-bg-base,#fff);color:inherit;}',
        '.dsh-clock-settings-check{display:flex;align-items:center;gap:6px;cursor:pointer;}',
        '.dsh-clock-settings-btn{font:inherit;font-size:13px;font-weight:700;cursor:pointer;',
        'padding:8px 16px;border-radius:999px;border:0;color:#fff;',
        'background:linear-gradient(135deg,#ff9a4d,#f06a8a);}',
        '.dsh-clock-settings-btn.ghost{background:0 0;border:1.5px solid #ffd9a0;color:#a8601f;}',
        '.dsh-clock-settings-btn:disabled{opacity:.5;cursor:default;}',
        '.dsh-clock-settings-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#8a7a66);}',
        '.dsh-clock-settings-msg{font-size:12.5px;color:#2e7d32;margin-top:8px;}',
        '.dsh-clock-settings-msg.err{color:#c0392b;}',
        '.dsh-clock-plan{border:1px solid rgba(255,180,90,.28);border-radius:12px;',
        'padding:8px 10px;margin:8px 0;background:rgba(255,217,160,.10);}',
        '.dsh-clock-plan-head{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;}',
        '.dsh-clock-plan-emoji{font-size:18px;}',
        '.dsh-clock-plan-title{font-weight:700;flex:1;}',
        '.dsh-clock-plan-meta{font-size:12px;color:var(--dsw-alias-label-secondary,#8a7a66);',
        'font-variant-numeric:tabular-nums;}',
        '.dsh-clock-plan-summary{font-size:12.5px;color:var(--dsw-alias-label-secondary,#8a7a66);margin:2px 0 0 26px;}',
        '.dsh-clock-plan-steps{display:flex;flex-direction:column;gap:4px;margin:8px 0 2px 26px;font-size:12.5px;}',
        '.dsh-clock-plan-step{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;}',
        '.dsh-clock-plan-step b{min-width:96px;font-weight:700;}',
        '.dsh-clock-plan-step span{min-width:110px;color:var(--dsw-alias-label-secondary,#8a7a66);}',
        '.dsh-clock-plan-step em{font-style:normal;color:var(--dsw-alias-label-secondary,#8a7a66);opacity:.85;}'
      ].join('');
    }

    function ensureStyle() {
      if (typeof document === 'undefined' || !document.head) return;
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = clockCss();
      document.head.appendChild(style);
    }

    // ── 组件 ────────────────────────────────────────────────────────────────

    /** 长按 3 秒紧急跳过。 */
    function SkipButton(props) {
      const [holdPct, setHoldPct] = React.useState(0);
      const rafRef = React.useRef(0);
      const startRef = React.useRef(0);

      const cancel = React.useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        setHoldPct(0);
      }, []);

      React.useEffect(() => cancel, [cancel]);

      const step = React.useCallback(() => {
        const pct = Math.min(100, ((Date.now() - startRef.current) / SKIP_HOLD_MS) * 100);
        setHoldPct(pct);
        if (pct >= 100) {
          rafRef.current = 0;
          setHoldPct(0);
          props.onSkip();
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      }, [props]);

      const begin = React.useCallback(
        (event) => {
          event.preventDefault();
          startRef.current = Date.now();
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(step);
        },
        [step]
      );

      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-clock-skip',
          title: '有急事？按住不放 3 秒可以跳过这次休息',
          'aria-label': '长按 3 秒紧急跳过本次休息',
          onPointerDown: begin,
          onPointerUp: cancel,
          onPointerLeave: cancel,
          onPointerCancel: cancel,
          onContextMenu: (event) => event.preventDefault()
        },
        React.createElement('span', {
          className: 'dsh-clock-skip-fill',
          style: { transform: `scaleX(${holdPct / 100})` }
        }),
        React.createElement(
          'span',
          { className: 'dsh-clock-skip-label' },
          holdPct > 0
            ? `再按住 ${(Math.ceil((SKIP_HOLD_MS * (100 - holdPct)) / 100 / 100) / 10).toFixed(1)} 秒…`
            : '长按这里 3 秒可紧急跳过'
        )
      );
    }

    /** 步骤指示灯（运动指示灯）。 */
    function PlanDots(props) {
      return React.createElement(
        'div',
        { className: 'dsh-clock-dots' },
        props.steps.map((step, index) =>
          React.createElement('span', {
            key: `${step.name}-${index}`,
            className: `dsh-clock-dot${index < props.activeIndex ? ' is-done' : ''}${
              index === props.activeIndex ? ' is-on' : ''
            }`,
            title: step.name
          })
        )
      );
    }

    /** 「第 3/9 步 · 提踵 30×2 组 · 第 1/2 组」。 */
    function StepBadge(props) {
      const step = props.step;
      const parts = [`第 ${props.index + 1}/${props.total} 步`];
      if (step.group) parts.push(step.group);
      if (step.set && step.sets) parts.push(`第 ${step.set}/${step.sets} 组`);
      return React.createElement('div', { className: 'dsh-clock-step-badge' }, parts.join(' · '));
    }

    /**
     * 休息中的引导卡片：
     *   准备 10 秒 → 按计划一步步做（次数型倒数 / 休息型读秒）→ 完成。
     */
    function RestCard(props) {
      const { plan, now, deadline, restSeconds, startedAt, onSkip } = props;
      const elapsed = Math.max(0, (now - startedAt) / 1000);
      const overallRemaining = Math.max(0, deadline - now);
      const overallPct = Math.min(100, Math.round((elapsed / Math.max(1, restSeconds)) * 100));

      // 兼容旧版宿主：如果计划里还没有 steps，就退回简单卡片，别把弹窗弄坏。
      if (!Array.isArray(plan?.steps) || plan.steps.length === 0) {
        return React.createElement(
          'div',
          { className: 'dsh-clock-card dsh-clock-pop', role: 'dialog', 'aria-modal': 'true', 'aria-label': '休息时间到' },
          React.createElement('div', { className: 'dsh-clock-chick' }, '🐣'),
          React.createElement('div', { className: 'dsh-clock-title' }, '✨ 起来动一动！✨'),
          React.createElement('div', { className: 'dsh-clock-task' }, `${plan?.emoji ?? ''} ${plan?.title ?? '休息一下'}`),
          React.createElement('div', { className: 'dsh-clock-detail' }, plan?.detail || plan?.summary || ''),
          React.createElement('div', { className: 'dsh-clock-step-count' }, formatMs(overallRemaining)),
          React.createElement(
            'div',
            {
              className: 'dsh-clock-bar',
              role: 'progressbar',
              'aria-valuenow': overallPct,
              'aria-valuemin': 0,
              'aria-valuemax': 100
            },
            React.createElement('div', { className: 'dsh-clock-bar-fill', style: { width: `${overallPct}%` } })
          ),
          React.createElement(
            'button',
            { type: 'button', className: 'dsh-clock-done-btn', disabled: true },
            '我休息好啦'
          ),
          React.createElement(SkipButton, { onSkip })
        );
      }

      const timeline = buildPlanTimeline(plan, restSeconds);
      const position = locateTimeline(timeline, elapsed);
      const urgent = overallRemaining <= 10000;

      const footer = [
        React.createElement(
          'div',
          { className: 'dsh-clock-overall', key: 'overall' },
          React.createElement(
            'div',
            { className: 'dsh-clock-overall-row' },
            React.createElement('span', null, '总剩余'),
            React.createElement('b', { className: urgent ? 'dsh-clock-urgent' : '' }, formatMs(overallRemaining))
          ),
          React.createElement(
            'div',
            {
              className: 'dsh-clock-bar',
              role: 'progressbar',
              'aria-valuenow': overallPct,
              'aria-valuemin': 0,
              'aria-valuemax': 100
            },
            React.createElement('div', { className: 'dsh-clock-bar-fill', style: { width: `${overallPct}%` } })
          )
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-clock-done-btn',
            disabled: true,
            title: '倒计时走完就能点啦',
            key: 'done'
          },
          '我休息好啦'
        ),
        React.createElement(SkipButton, { onSkip, key: 'skip' })
      ];

      let body;
      if (position.mode === 'prepare') {
        const first = timeline.steps[0];
        body = [
          React.createElement('div', { className: 'dsh-clock-chick', key: 'chick' }, '🐣'),
          React.createElement('div', { className: 'dsh-clock-title', key: 'title' }, '✨ 准备一下！✨'),
          React.createElement(
            'div',
            { className: 'dsh-clock-summary', key: 'summary' },
            `本组我们选择：${plan.summary} 哦！`
          ),
          React.createElement(
            'div',
            { className: 'dsh-clock-prepare-num', key: 'num', 'aria-live': 'polite' },
            String(Math.max(1, Math.ceil(position.remaining)))
          ),
          React.createElement(
            'div',
            { className: 'dsh-clock-prepare-hint', key: 'hint' },
            first ? `${Math.ceil(position.remaining)} 秒后开始，我们先做「${first.name}」` : '马上开始'
          ),
          first
            ? React.createElement(PlanDots, { steps: timeline.steps, activeIndex: -1, key: 'dots' })
            : null,
          first ? React.createElement('div', { className: 'dsh-clock-step-cue', key: 'cue' }, first.cue) : null
        ];
      } else if (position.mode === 'step') {
        const step = position.step;
        const next = timeline.steps[position.index + 1];
        const isReps = step.kind === 'reps' && Number(step.target) > 0;
        const remainingCount = isReps
          ? Math.max(0, Math.ceil(step.target * (position.remaining / Math.max(1, step.duration))))
          : 0;
        const stepPct = Math.min(100, Math.round(position.progress * 100));
        body = [
          React.createElement(
            'div',
            { className: 'dsh-clock-planline', key: 'plan' },
            `${plan.emoji} ${plan.title} · ${plan.summary}`
          ),
          React.createElement(StepBadge, {
            key: 'badge',
            step,
            index: position.index,
            total: timeline.steps.length
          }),
          React.createElement(PlanDots, {
            key: 'dots',
            steps: timeline.steps,
            activeIndex: position.index
          }),
          React.createElement('div', { className: 'dsh-clock-step-name', key: 'name' }, step.name),
          React.createElement('div', { className: 'dsh-clock-step-cue', key: 'cue' }, step.cue),
          React.createElement(
            'div',
            { className: 'dsh-clock-step-count', key: 'count', 'aria-live': 'polite' },
            isReps ? String(remainingCount) : String(Math.max(0, Math.ceil(position.remaining))),
            React.createElement(
              'span',
              { className: 'dsh-clock-step-unit' },
              isReps ? step.unit || '个' : '秒'
            )
          ),
          React.createElement(
            'div',
            {
              className: 'dsh-clock-bar',
              key: 'bar',
              role: 'progressbar',
              'aria-valuenow': stepPct,
              'aria-valuemin': 0,
              'aria-valuemax': 100
            },
            React.createElement('div', { className: 'dsh-clock-bar-fill', style: { width: `${stepPct}%` } })
          ),
          React.createElement(
            'div',
            { className: 'dsh-clock-next', key: 'next' },
            next ? `下一项：${next.name}` : '最后一项，做完就结束啦'
          )
        ];
      } else {
        body = [
          React.createElement('div', { className: 'dsh-clock-chick', key: 'chick' }, '🎉'),
          React.createElement('div', { className: 'dsh-clock-title', key: 'title' }, '完成啦！'),
          React.createElement('div', { className: 'dsh-clock-summary', key: 'summary' }, '马上进入休息结束…')
        ];
      }

      return React.createElement(
        'div',
        {
          className: 'dsh-clock-card dsh-clock-pop',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '休息时间到'
        },
        ...body,
        ...footer
      );
    }

    /** 休息结束的卡片。 */
    function DoneCard(props) {
      return React.createElement(
        'div',
        {
          className: 'dsh-clock-card dsh-clock-pop',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '休息结束'
        },
        React.createElement('div', { className: 'dsh-clock-chick' }, '🎉'),
        React.createElement('div', { className: 'dsh-clock-title' }, '休息好啦！'),
        React.createElement(
          'div',
          { className: 'dsh-clock-detail' },
          props.skipped
            ? '这次先跳过啦，下次记得补上 (๑•̀ㅂ•́)و✧'
            : props.plan
              ? `你刚刚完成了「${props.plan.title}」，真棒`
              : '这一轮休息结束啦，真棒'
        ),
        React.createElement('div', { className: 'dsh-clock-kaomoji' }, '(๑•̀ㅂ•́)و✧'),
        React.createElement(
          'button',
          { type: 'button', className: 'dsh-clock-done-btn', onClick: props.onNext },
          '开始下一轮'
        )
      );
    }

    /** 浮层本体（挂在 shell.overlay）。工作中返回 null。 */
    function ClockOverlay() {
      const snap = useClock();
      if (!snap || !snap.state) return null;
      const state = snap.state;
      if (state.phase === 'work') return null;

      const plan = state.plan;
      return React.createElement(
        'div',
        { className: 'dsh-clock-backdrop' },
        state.phase === 'rest' && plan
          ? React.createElement(RestCard, {
              plan,
              deadline: state.deadline,
              now: snap.now,
              restSeconds: state.restSeconds,
              startedAt: state.startedAt,
              onSkip: () => store.skipRest()
            })
          : React.createElement(DoneCard, {
              plan,
              skipped: Boolean(state.skipped),
              onNext: () => store.startNextRound()
            })
      );
    }

    /** 左下角详情面板。 */
    function ClockPanel(props) {
      const { snap, onClose } = props;
      const state = snap.state;
      const [pending, setPending] = React.useState(null);

      const head = React.createElement(
        'div',
        { className: 'dsh-clock-panel-head' },
        React.createElement('span', { className: 'dsh-clock-panel-title' }, '🐣 健康钟'),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-clock-panel-close',
            onClick: onClose,
            'aria-label': '关闭详情'
          },
          '×'
        )
      );

      if (!state) {
        return React.createElement(
          'div',
          { className: 'dsh-clock-panel', role: 'dialog', 'aria-label': '健康钟详情' },
          head,
          React.createElement(
            'div',
            { className: 'dsh-clock-panel-note' },
            snap.connected
              ? '正在读取状态…'
              : '连不上宿主。请完全退出 DSH 再打开（宿主半边要重启才加载）。'
          ),
          snap.error ? React.createElement('div', { className: 'dsh-clock-panel-row' }, snap.error) : null
        );
      }

      const remaining = Math.max(0, state.deadline - snap.now);
      const isRest = state.phase === 'rest';
      const isWork = state.phase === 'work';
      const isDone = state.phase === 'done';
      const workMs = (state.workSeconds ?? 0) * 1000;
      const elapsedPct =
        isWork && workMs > 0
          ? Math.min(100, Math.round(((snap.now - state.startedAt) / workMs) * 100))
          : 0;
      const restPct =
        isRest && state.restSeconds > 0
          ? Math.min(100, Math.round((1 - remaining / (state.restSeconds * 1000)) * 100))
          : 0;
      const pct = isWork ? elapsedPct : isRest ? restPct : 100;

      const rows = [
        React.createElement(
          'div',
          { className: 'dsh-clock-panel-row', key: 'phase' },
          React.createElement('span', null, '状态'),
          React.createElement('b', null, phaseLabel(state.phase))
        ),
        React.createElement(
          'div',
          { className: 'dsh-clock-panel-row', key: 'next' },
          React.createElement('span', null, isWork ? '下次提醒' : isRest ? '休息结束' : '下一轮'),
          React.createElement('b', null, isDone ? '点按钮开始' : formatClock(state.deadline))
        ),
        React.createElement(
          'div',
          { className: 'dsh-clock-panel-row', key: 'count' },
          React.createElement('span', null, '今天完成'),
          React.createElement('b', null, `${state.doneCount ?? 0} 次`)
        )
      ];

      if (state.plan) {
        rows.push(
          React.createElement(
            'div',
            { className: 'dsh-clock-panel-row', key: 'plan' },
            React.createElement('span', null, '本次计划'),
            React.createElement('b', null, `${state.plan.emoji} ${state.plan.title}`)
          )
        );
      }

      const actions = [];
      if (isWork) {
        actions.push(
          React.createElement(
            'button',
            { type: 'button', className: 'dsh-clock-panel-btn', key: 'rest', onClick: props.onRestNow },
            '现在休息一下'
          )
        );
      }
      if (isDone) {
        actions.push(
          React.createElement(
            'button',
            { type: 'button', className: 'dsh-clock-panel-btn', key: 'next', onClick: props.onNext },
            '开始下一轮'
          )
        );
      }
      actions.push(
        React.createElement(
          'button',
          { type: 'button', className: 'dsh-clock-panel-btn ghost', key: 'reset', onClick: props.onReset },
          '重新计时'
        )
      );
      if (props.devMode) {
        actions.push(
          React.createElement(
            'button',
            { type: 'button', className: 'dsh-clock-panel-btn ghost', key: 'wake', onClick: props.onWake },
            '测试提醒'
          )
        );
      }

      return React.createElement(
        'div',
        { className: 'dsh-clock-panel', role: 'dialog', 'aria-label': '健康钟详情' },
        head,
        React.createElement('div', { className: 'dsh-clock-panel-big' }, isDone ? '🎉' : formatMs(remaining)),
        React.createElement(
          'div',
          { className: 'dsh-clock-bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
          React.createElement('div', { className: 'dsh-clock-bar-fill', style: { width: `${pct}%` } })
        ),
        React.createElement('div', { className: 'dsh-clock-panel-sep' }),
        rows,
        React.createElement('div', { className: 'dsh-clock-panel-sep' }),
        React.createElement('div', { className: 'dsh-clock-panel-actions' }, actions),
        isRest
          ? React.createElement(
              'div',
              { className: 'dsh-clock-panel-note' },
              '休息中：想提前结束，请长按卡片上的「紧急跳过」3 秒。'
            )
          : null,
        React.createElement('div', { className: 'dsh-clock-panel-sep' }),
        React.createElement(
          'div',
          { className: 'dsh-clock-future' },
          FUTURE_FEATURES.map((item) =>
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-clock-future-item',
                key: item.id,
                title: '这个入口先占个位，功能还在路上',
                onClick: () => setPending(item.label)
              },
              React.createElement('span', null, item.icon),
              React.createElement('span', null, item.label),
              React.createElement('em', null, item.hint)
            )
          )
        ),
        pending
          ? React.createElement(
              'div',
              { className: 'dsh-clock-panel-note' },
              `「${pending}」还在开发中，下个版本见 (๑•̀ㅂ•́)و✧`
            )
          : null
      );
    }

    /** 左下角入口 + 详情面板。 */
    function ClockFooterButton(props) {
      const wide = props?.wide === true;
      const snap = useClock();
      const [open, setOpen] = React.useState(false);
      const btnRef = React.useRef(null);
      const panelRef = React.useRef(null);

      React.useEffect(() => {
        if (!open) return undefined;
        const onDown = (event) => {
          if (panelRef.current && panelRef.current.contains(event.target)) return;
          if (btnRef.current && btnRef.current.contains(event.target)) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('pointerdown', onDown, true);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      // 进入休息 / 完成后自动收起面板，避免盖在幕布上。
      const phase = snap?.state?.phase;
      React.useEffect(() => {
        if (phase && phase !== 'work') setOpen(false);
      }, [phase]);

      const state = snap?.state;
      let text = '健康钟';
      let icon = '🐣';
      let offline = false;

      if (!snap || !state) {
        text = snap && snap.connected === false ? '健康钟 · 连接中' : '健康钟';
        if (snap && snap.connected === false && snap.error) {
          text = '健康钟 · 离线';
          offline = true;
        }
      } else if (state.phase === 'work') {
        text = `健康钟 ${formatMs(state.deadline - snap.now)}`;
      } else if (state.phase === 'rest') {
        text = `休息中 ${formatMs(state.deadline - snap.now)}`;
        icon = '⏰';
      } else {
        text = '休息好啦！';
        icon = '🎉';
      }

      const devMode = Boolean(state?.devMode);

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'button',
          {
            type: 'button',
            ref: btnRef,
            className: `dsh-clock-open${wide ? '' : ' dsh-clock-open-rail'}`,
            title: `健康钟 v${CLIENT_VERSION}（点开看详情）`,
            'aria-label': '健康钟：点开看详情',
            'aria-expanded': open,
            'data-open': open ? 'true' : 'false',
            'data-offline': offline ? 'true' : 'false',
            onClick: () => setOpen((value) => !value)
          },
          React.createElement('span', { className: 'dsh-clock-open-icon' }, icon),
          wide ? React.createElement('span', { className: 'dsh-clock-open-label' }, text) : null
        ),
        open
          ? React.createElement(
              'div',
              { ref: panelRef },
              React.createElement(ClockPanel, {
                snap,
                onClose: () => setOpen(false),
                devMode,
                onRestNow: () => store.startRestNow(),
                onNext: () => store.startNextRound(),
                onReset: () => store.reset(),
                onWake: () => store.testWake()
              })
            )
          : null
      );
    }

    /** 设置页：工作时长、休息时长、计划库（含添加/修改入口）。 */
    function ClockSettingsPage() {
      const [settings, setSettings] = React.useState(null);
      const [plans, setPlans] = React.useState([]);
      const [work, setWork] = React.useState('45');
      const [followPlan, setFollowPlan] = React.useState(true);
      const [rest, setRest] = React.useState('12');
      const [openPlan, setOpenPlan] = React.useState(null);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState('');
      const [error, setError] = React.useState('');

      React.useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const [settingsData, plansData] = await Promise.all([request('/settings'), request('/plans')]);
            if (!alive) return;
            setSettings(settingsData.settings);
            setPlans(plansData.plans);
            setWork(String(settingsData.settings.workMinutes));
            setFollowPlan(settingsData.settings.restMinutes === 0);
            setRest(String(settingsData.settings.restMinutes === 0 ? 12 : settingsData.settings.restMinutes));
          } catch (err) {
            if (alive) setError(String(err?.message ?? err));
          }
        })();
        return () => {
          alive = false;
        };
      }, []);

      async function save() {
        setSaving(true);
        setMessage('');
        setError('');
        try {
          const data = await request('/settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              workMinutes: Number(work),
              restMinutes: followPlan ? 0 : Number(rest)
            })
          });
          setSettings(data.settings);
          setWork(String(data.settings.workMinutes));
          setFollowPlan(data.settings.restMinutes === 0);
          setRest(String(data.settings.restMinutes === 0 ? 12 : data.settings.restMinutes));
          setMessage('已保存。工作时长下一轮生效；休息时长下一次休息生效。');
        } catch (err) {
          setError(String(err?.message ?? err));
        } finally {
          setSaving(false);
        }
      }

      async function copyPlans() {
        try {
          await navigator.clipboard.writeText(JSON.stringify(plans, null, 2));
          setMessage('计划 JSON 已复制到剪贴板。');
        } catch {
          setError('复制失败；可以直接打开 lib/plans.js 修改。');
        }
      }

      const header = React.createElement(
        'div',
        null,
        React.createElement('h2', null, '🐣 健康钟'),
        React.createElement(
          'div',
          { className: 'dsh-clock-settings-sub' },
          '工作一会儿，起来动一动。设置会保存到本机，下次启动继续用。'
        )
      );

      if (!settings) {
        return React.createElement(
          'div',
          { className: 'dsh-clock-settings' },
          header,
          React.createElement(
            'div',
            { className: error ? 'dsh-clock-settings-msg err' : 'dsh-clock-settings-msg' },
            error || '正在读取设置…'
          )
        );
      }

      const planList = plans.map((item) => {
        const expanded = openPlan === item.id;
        return React.createElement(
          'div',
          { className: 'dsh-clock-plan', key: item.id },
          React.createElement(
            'div',
            {
              className: 'dsh-clock-plan-head',
              role: 'button',
              tabIndex: 0,
              onClick: () => setOpenPlan(expanded ? null : item.id),
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setOpenPlan(expanded ? null : item.id);
                }
              }
            },
            React.createElement('span', { className: 'dsh-clock-plan-emoji' }, item.emoji),
            React.createElement('span', { className: 'dsh-clock-plan-title' }, item.title),
            React.createElement(
              'span',
              { className: 'dsh-clock-plan-meta' },
              `${formatMs(item.totalSeconds * 1000)} · ${item.steps.length} 步`
            )
          ),
          React.createElement('div', { className: 'dsh-clock-plan-summary' }, item.summary),
          expanded
            ? React.createElement(
                'div',
                { className: 'dsh-clock-plan-steps' },
                item.steps.map((step, index) =>
                  React.createElement(
                    'div',
                    { className: 'dsh-clock-plan-step', key: `${item.id}-${index}` },
                    React.createElement('b', null, step.kind === 'rest' ? '休息' : step.name),
                    React.createElement(
                      'span',
                      null,
                      step.kind === 'rest'
                        ? `${step.seconds} 秒`
                        : `${step.target} ${step.unit || '个'} / ${step.seconds} 秒`
                    ),
                    React.createElement('em', null, step.cue)
                  )
                )
              )
            : null
        );
      });

      return React.createElement(
        'div',
        { className: 'dsh-clock-settings' },
        header,
        React.createElement(
          'div',
          { className: 'dsh-clock-settings-card' },
          React.createElement('h3', null, '计时'),
          React.createElement(
            'div',
            { className: 'dsh-clock-settings-row' },
            React.createElement('span', { className: 'dsh-clock-settings-label' }, '工作时长'),
            React.createElement('input', {
              className: 'dsh-clock-settings-input',
              type: 'number',
              min: 5,
              max: 120,
              value: work,
              onChange: (event) => setWork(event.target.value)
            }),
            React.createElement('span', { className: 'dsh-clock-settings-hint' }, '分钟（5～120）'),
            ...[25, 45, 60].map((minutes) =>
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsh-clock-settings-btn ghost',
                  key: `work-${minutes}`,
                  onClick: () => setWork(String(minutes))
                },
                String(minutes)
              )
            )
          ),
          React.createElement(
            'div',
            { className: 'dsh-clock-settings-row' },
            React.createElement('span', { className: 'dsh-clock-settings-label' }, '休息时长'),
            React.createElement(
              'label',
              { className: 'dsh-clock-settings-check' },
              React.createElement('input', {
                type: 'checkbox',
                checked: followPlan,
                onChange: (event) => setFollowPlan(event.target.checked)
              }),
              '跟随计划（12～15 分钟）'
            ),
            followPlan
              ? null
              : React.createElement('input', {
                  className: 'dsh-clock-settings-input',
                  type: 'number',
                  min: 5,
                  max: 30,
                  value: rest,
                  onChange: (event) => setRest(event.target.value)
                }),
            followPlan
              ? null
              : React.createElement('span', { className: 'dsh-clock-settings-hint' }, '分钟（5～30）')
          ),
          React.createElement(
            'div',
            { className: 'dsh-clock-settings-hint' },
            '固定休息时长会按比例缩放动作节奏（动作次数不变）。'
          ),
          React.createElement(
            'div',
            { className: 'dsh-clock-settings-row' },
            React.createElement(
              'button',
              { type: 'button', className: 'dsh-clock-settings-btn', disabled: saving, onClick: save },
              saving ? '保存中…' : '保存设置'
            )
          ),
          message ? React.createElement('div', { className: 'dsh-clock-settings-msg' }, message) : null,
          error ? React.createElement('div', { className: 'dsh-clock-settings-msg err' }, error) : null
        ),
        React.createElement(
          'div',
          { className: 'dsh-clock-settings-card' },
          React.createElement('h3', null, '计划库（12 套）'),
          React.createElement(
            'div',
            { className: 'dsh-clock-settings-hint' },
            '每套 12～15 分钟，弹窗会按步骤倒数；点标题展开动作细节。'
          ),
          planList,
          React.createElement(
            'div',
            { className: 'dsh-clock-settings-row' },
            React.createElement(
              'button',
              { type: 'button', className: 'dsh-clock-settings-btn ghost', onClick: copyPlans },
              '复制计划 JSON'
            ),
            React.createElement(
              'span',
              { className: 'dsh-clock-settings-hint' },
              '当前修改入口：lib/plans.js（改完完全重启 DSH）；可视化编辑器下一轮做。'
            )
          )
        )
      );
    }

    // ── 注册 ────────────────────────────────────────────────────────────────
    const inject = ['slots'];

    /**
     * 客户端插件入口：建仓库 → 注册浮层 → 注册左下角入口。
     * 所有清理都挂在 ctx.effect 下。
     */
    function apply(ctx) {
      ensureStyle();
      store = createClockStore();
      store.start();

      const disposeOverlay = ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'dsh-clock', order: 100, label: '健康钟' },
          () => React.createElement(ClockOverlay, null)
        )
      );

      const disposeFooter = ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'dsh-clock', order: 30, label: '健康钟' },
          (slotProps) => React.createElement(ClockFooterButton, { ...slotProps })
        )
      );

      const disposeSettings = ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'dsh-clock', order: 25, label: '健康钟' },
          (slotProps) => React.createElement(ClockSettingsPage, { ...slotProps })
        )
      );

      ctx.effect(
        () => () => {
          for (const dispose of [disposeOverlay, disposeFooter, disposeSettings]) {
            try {
              if (typeof dispose === 'function') dispose();
            } catch {
              /* 逐项清理 */
            }
          }
          if (store) {
            try {
              store.dispose();
            } catch {
              /* 同上 */
            }
            store = null;
          }
          if (typeof document !== 'undefined') {
            const style = document.getElementById(STYLE_ID);
            if (style) style.remove();
          }
        },
        'dsh-clock: 清理浮层、入口按钮与轮询'
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.CLIENT_VERSION = CLIENT_VERSION;

    return module.exports;
  }
});
