import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

/* ───────────── 타입 ───────────── */
type MediaType = 'video' | 'image';
type Ratio = '16:9' | '9:16' | '1:1';
type CapPos = 'top' | 'center' | 'bottom';

interface Clip {
  id: string;
  type: MediaType;
  name: string;
  file: File;
  url: string;
  srcDuration: number; // 원본 길이(이미지는 의미 없음)
  inPoint: number;     // 원본 기준 시작점(초)
  outPoint: number;    // 원본 기준 끝점(초)
}

const RATIO_SIZE: Record<Ratio, [number, number]> = {
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '1:1': [720, 720],
};

const FPS = 30;
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** 방송식 타임코드 MM:SS:FF */
const tc = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const ff = Math.floor((s % 1) * FPS);
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
};

const getVideoDuration = (url: string) =>
  new Promise<number>((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(isFinite(v.duration) && v.duration > 0 ? v.duration : 5);
    v.onerror = () => resolve(5);
    v.src = url;
  });

/* ───────────── 앱 ───────────── */
function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ratio, setRatio] = useState<Ratio>('16:9');
  const [caption, setCaption] = useState('');
  const [capPos, setCapPos] = useState<CapPos>('bottom');
  const [mute, setMute] = useState(false);
  const [pps, setPps] = useState(40); // pixel per second (타임라인 줌)

  // 엔진 상태
  const [engineState, setEngineState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  const ffmpegRef = useRef(new FFmpeg());
  const engineStarted = useRef(false);
  const stepRef = useRef({ i: 0, n: 1 });
  const logsRef = useRef<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState({ w: 640, h: 360 });

  /* ── 타임라인 계산 ── */
  const timeline = useMemo(() => {
    let t = 0;
    return clips.map((clip) => {
      const start = t;
      t += clip.outPoint - clip.inPoint;
      return { clip, start, end: t };
    });
  }, [clips]);
  const total = timeline.length ? timeline[timeline.length - 1].end : 0;

  const entryAt = useCallback(
    (t: number) => {
      if (!timeline.length) return null;
      return timeline.find((e) => t >= e.start && t < e.end) ?? timeline[timeline.length - 1];
    },
    [timeline]
  );
  const current = entryAt(playhead);

  // 최신 값 참조용 ref (rAF 루프/이벤트 핸들러에서 사용)
  const S = useRef({ playhead, timeline, total, pps, playing, current });
  S.current = { playhead, timeline, total, pps, playing, current };

  /* ── 엔진 로딩 ── */
  useEffect(() => {
    if (engineStarted.current) return;
    engineStarted.current = true;
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on('progress', ({ progress: p }) => {
      const { i, n } = stepRef.current;
      const local = clamp(isFinite(p) ? p : 0, 0, 1);
      setProgress(Math.round(((i + local) / n) * 100));
    });
    ffmpeg.on('log', ({ message }) => {
      logsRef.current.push(message);
      if (logsRef.current.length > 40) logsRef.current.shift();
    });
    (async () => {
      try {
        // @ffmpeg/ffmpeg 0.12.x 는 모듈 워커를 쓰므로 반드시 ESM 코어를 사용해야 함
        const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        await ffmpeg.load({
          coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setEngineState('ready');
      } catch (e) {
        console.error('FFmpeg 로딩 실패:', e);
        setEngineState('error');
      }
    })();
  }, []);

  /* ── 미리보기 박스 크기 맞추기 ── */
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setBoxSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [RW, RH] = RATIO_SIZE[ratio];
  const fitW = Math.min(boxSize.w, boxSize.h * (RW / RH));
  const fitH = fitW / (RW / RH);

  /* ── 파일 가져오기 ── */
  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const added: Clip[] = [];
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      if (file.type.startsWith('image')) {
        added.push({ id: uid(), type: 'image', name: file.name, file, url, srcDuration: 3, inPoint: 0, outPoint: 3 });
      } else {
        const d = await getVideoDuration(url);
        added.push({ id: uid(), type: 'video', name: file.name, file, url, srcDuration: d, inPoint: 0, outPoint: d });
      }
    }
    setClips((prev) => [...prev, ...added]);
    if (!selectedId && added[0]) setSelectedId(added[0].id);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /* ── 재생 동기화 ── */
  const seekVideoToPlayhead = () => {
    const v = videoRef.current;
    const e = S.current.current;
    if (!v || !e || e.clip.type !== 'video' || v.readyState < 1) return;
    const target = e.clip.inPoint + (S.current.playhead - e.start);
    if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
  };

  // 클립이 바뀌면 영상 위치 맞추고, 재생중이면 이어서 재생
  useEffect(() => {
    seekVideoToPlayhead();
    const v = videoRef.current;
    if (v && current?.clip.type === 'video') {
      if (playing) v.play().catch(() => {});
      else v.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.clip.id, playing]);

  // 정지 상태에서 스크러빙하면 영상도 따라감
  useEffect(() => {
    if (!playing) seekVideoToPlayhead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, playing]);

  // 재생 루프
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const { playhead: ph, total: tot } = S.current;
      const e = S.current.current;
      if (!e) { setPlaying(false); return; }
      let np = ph;
      if (e.clip.type === 'image') {
        np = ph + dt;
      } else {
        const v = videoRef.current;
        if (v && v.readyState >= 2 && !v.seeking) np = e.start + (v.currentTime - e.clip.inPoint);
      }
      if (np >= e.end - 0.01) np = e.end + 0.0001; // 다음 클립으로
      if (np >= tot) {
        setPlayhead(tot);
        setPlaying(false);
        return;
      }
      setPlayhead(np);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const togglePlay = () => {
    if (!clips.length) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (playhead >= total - 0.02) setPlayhead(0);
    setPlaying(true);
  };

  /* ── 편집 기능 ── */
  const targetEntry = () => {
    const e = S.current.current;
    return e;
  };

  const splitAtPlayhead = () => {
    const e = targetEntry();
    if (!e) return;
    const local = e.clip.inPoint + (playhead - e.start);
    if (local - e.clip.inPoint < 0.1 || e.clip.outPoint - local < 0.1) return;
    const a: Clip = { ...e.clip, id: uid(), outPoint: local };
    const b: Clip = { ...e.clip, id: uid(), inPoint: local };
    setClips((prev) => prev.flatMap((c) => (c.id === e.clip.id ? [a, b] : [c])));
    setSelectedId(b.id);
  };

  const setInAtPlayhead = () => {
    const e = targetEntry();
    if (!e) return;
    const local = e.clip.inPoint + (playhead - e.start);
    if (e.clip.outPoint - local < 0.1) return;
    if (e.clip.type === 'image') {
      // 이미지는 시작점을 당기면 길이가 줄어듦
      const newDur = e.clip.outPoint - (local - e.clip.inPoint);
      setClips((prev) => prev.map((c) => (c.id === e.clip.id ? { ...c, outPoint: Math.max(0.5, newDur) } : c)));
    } else {
      setClips((prev) => prev.map((c) => (c.id === e.clip.id ? { ...c, inPoint: local } : c)));
    }
    setPlayhead(e.start);
    setSelectedId(e.clip.id);
  };

  const setOutAtPlayhead = () => {
    const e = targetEntry();
    if (!e) return;
    const local = e.clip.inPoint + (playhead - e.start);
    if (local - e.clip.inPoint < 0.1) return;
    setClips((prev) => prev.map((c) => (c.id === e.clip.id ? { ...c, outPoint: local } : c)));
    setSelectedId(e.clip.id);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setClips((prev) => prev.filter((c) => c.id !== selectedId));
    setSelectedId(null);
    setPlaying(false);
  };

  const moveSelected = (dir: -1 | 1) => {
    if (!selectedId) return;
    setClips((prev) => {
      const i = prev.findIndex((c) => c.id === selectedId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const setImageDuration = (sec: number) => {
    if (!selectedId) return;
    setClips((prev) => prev.map((c) => (c.id === selectedId && c.type === 'image' ? { ...c, inPoint: 0, outPoint: sec } : c)));
  };

  /* ── 단축키 (I / O / S / Space / Delete / ←→) ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); togglePlay(); }
      else if (k === 's') splitAtPlayhead();
      else if (k === 'i') setInAtPlayhead();
      else if (k === 'o') setOutAtPlayhead();
      else if (k === 'delete' || k === 'backspace') deleteSelected();
      else if (k === 'arrowleft') { setPlaying(false); setPlayhead((p) => Math.max(0, p - 1 / FPS)); }
      else if (k === 'arrowright') { setPlaying(false); setPlayhead((p) => Math.min(total, p + 1 / FPS)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ── 타임라인 마우스 (스크러빙 + 클립 끝 잡고 트리밍) ── */
  type Drag =
    | { kind: 'scrub' }
    | { kind: 'trimL' | 'trimR'; id: string; startX: number; origIn: number; origOut: number };
  const dragRef = useRef<Drag | null>(null);

  const xToTime = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clamp((clientX - rect.left) / S.current.pps, 0, S.current.total);
  };

  const scrubTo = (clientX: number) => {
    const t = xToTime(clientX);
    setPlayhead(t);
    const e = S.current.timeline.find((x) => t >= x.start && t < x.end);
    if (e) setSelectedId(e.clip.id);
  };

  const onTrackMouseDown = (e: React.MouseEvent) => {
    if (!clips.length) return;
    setPlaying(false);
    dragRef.current = { kind: 'scrub' };
    scrubTo(e.clientX);
  };

  const onHandleMouseDown = (e: React.MouseEvent, clip: Clip, side: 'L' | 'R') => {
    e.stopPropagation();
    setPlaying(false);
    setSelectedId(clip.id);
    dragRef.current = { kind: side === 'L' ? 'trimL' : 'trimR', id: clip.id, startX: e.clientX, origIn: clip.inPoint, origOut: clip.outPoint };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'scrub') { scrubTo(e.clientX); return; }
      const dx = (e.clientX - d.startX) / S.current.pps;
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== d.id) return c;
          if (c.type === 'image') {
            const dur = d.origOut - d.origIn;
            const nd = d.kind === 'trimR' ? dur + dx : dur - dx;
            return { ...c, inPoint: 0, outPoint: clamp(nd, 0.5, 60) };
          }
          if (d.kind === 'trimL') return { ...c, inPoint: clamp(d.origIn + dx, 0, d.origOut - 0.1) };
          return { ...c, outPoint: clamp(d.origOut + dx, d.origIn + 0.1, c.srcDuration) };
        })
      );
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 자막 PNG 만들기 (캔버스로 그려서 영상 위에 합성) ── */
  const makeCaptionPng = async (W: number, H: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    let size = Math.round(Math.min(W, H) * 0.08);
    const font = (s: number) => `bold ${s}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
    ctx.font = font(size);
    while (ctx.measureText(caption).width > W * 0.9 && size > 12) {
      size -= 2;
      ctx.font = font(size);
    }
    const y = capPos === 'top' ? H * 0.12 : capPos === 'center' ? H / 2 : H * 0.88;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size * 0.15);
    ctx.strokeStyle = 'black';
    ctx.strokeText(caption, W / 2, y);
    ctx.fillStyle = 'white';
    ctx.fillText(caption, W / 2, y);
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  };

  /* ── 내보내기 (클립별 규격 통일 → 이어붙이기) ── */
  const handleExport = async () => {
    if (!clips.length) return alert('타임라인에 소스를 먼저 올려주세요!');
    if (engineState !== 'ready') return alert('엔진이 아직 준비되지 않았습니다.');
    setPlaying(false);
    setExporting(true);
    setProgress(0);
    logsRef.current = [];

    const ffmpeg = ffmpegRef.current;
    const [W, H] = RATIO_SIZE[ratio];
    const hasCap = caption.trim().length > 0;
    const n = clips.length;
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS},format=yuv420p`;
    const enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k'];
    const segs: string[] = [];

    try {
      if (hasCap) await ffmpeg.writeFile('cap.png', await makeCaptionPng(W, H));

      for (let i = 0; i < n; i++) {
        const c = clips[i];
        stepRef.current = { i, n: n + 1 };
        setStatus(`클립 ${i + 1} / ${n} 변환 중...`);
        const ext = (c.name.split('.').pop() || 'bin').toLowerCase();
        const inName = `in${i}.${ext}`;
        const seg = `seg${i}.mp4`;
        const dur = (c.outPoint - c.inPoint).toFixed(3);
        await ffmpeg.writeFile(inName, await fetchFile(c.file));

        const capIn = hasCap ? ['-i', 'cap.png'] : [];
        const vChain = hasCap ? `[0:v]${vf}[b];[b][1:v]overlay=0:0,format=yuv420p[v]` : `[0:v]${vf}[v]`;
        const silent = `anullsrc=r=44100:cl=stereo,atrim=duration=${dur}[a]`;

        const srcIn = c.type === 'image'
          ? ['-loop', '1', '-t', dur, '-i', inName]
          : ['-ss', c.inPoint.toFixed(3), '-t', dur, '-i', inName];

        let code = 1;
        if (c.type === 'video' && !mute) {
          // 원본 소리 사용 시도
          code = await ffmpeg.exec([...srcIn, ...capIn, '-filter_complex', vChain, '-map', '[v]', '-map', '0:a:0', '-t', dur, ...enc, seg]);
        }
        if (code !== 0) {
          // 이미지 / 음소거 / 소리 없는 영상 → 무음 트랙으로 통일
          code = await ffmpeg.exec([...srcIn, ...capIn, '-filter_complex', `${vChain};${silent}`, '-map', '[v]', '-map', '[a]', '-t', dur, ...enc, seg]);
        }
        await ffmpeg.deleteFile(inName).catch(() => {});
        if (code !== 0) throw new Error(`클립 ${i + 1} (${c.name}) 변환 실패`);
        segs.push(seg);
      }

      // 이어붙이기 (모든 조각이 같은 규격이라 재인코딩 없이 복사)
      stepRef.current = { i: n, n: n + 1 };
      setStatus('클립 이어붙이는 중...');
      await ffmpeg.writeFile('list.txt', segs.map((s) => `file '${s}'`).join('\n'));
      const code = await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'out.mp4']);
      if (code !== 0) throw new Error('이어붙이기 실패');

      const data = (await ffmpeg.readFile('out.mp4')) as Uint8Array;
      const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: 'video/mp4' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `AION_MINI_${ratio.replace(':', 'x')}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp4`;
      a.click();
      setProgress(100);
      setStatus('완료! 다운로드 폴더를 확인하세요.');

      // 메모리 정리
      for (const s of segs) await ffmpeg.deleteFile(s).catch(() => {});
      await ffmpeg.deleteFile('list.txt').catch(() => {});
      await ffmpeg.deleteFile('out.mp4').catch(() => {});
      if (hasCap) await ffmpeg.deleteFile('cap.png').catch(() => {});
    } catch (err) {
      console.error(err, logsRef.current);
      alert(`렌더링 실패: ${(err as Error).message}\n\n[엔진 로그]\n${logsRef.current.slice(-8).join('\n')}`);
      for (const s of segs) await ffmpeg.deleteFile(s).catch(() => {});
    } finally {
      setTimeout(() => setExporting(false), 1200);
    }
  };

  /* ── 렌더 ── */
  const selected = clips.find((c) => c.id === selectedId) || null;
  const rulerStep = pps >= 60 ? 1 : pps >= 25 ? 2 : pps >= 12 ? 5 : 10;
  const rulerEnd = Math.max(total + 10, 30);
  const contentW = rulerEnd * pps;
  const capFont = Math.min(fitW, fitH) * 0.08;

  return (
    <div className="h-screen flex flex-col bg-[#121212] text-white overflow-hidden select-none">
      {/* Header */}
      <header className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between bg-black/50 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-brand rounded flex items-center justify-center font-black text-lg">A</div>
          <h1 className="text-lg font-bold tracking-widest">AION <span className="text-brand font-black">MINI</span></h1>
          <span className={`ml-3 text-[10px] px-2 py-0.5 rounded-full border ${engineState === 'ready' ? 'border-green-600 text-green-400' : engineState === 'error' ? 'border-red-600 text-red-400' : 'border-yellow-600 text-yellow-400'}`}>
            {engineState === 'ready' ? '● 렌더링 엔진 준비완료' : engineState === 'error' ? '● 엔진 로딩 실패 (인터넷 연결 확인 후 새로고침)' : '● 엔진 예열중...'}
          </span>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || engineState !== 'ready'}
          className={`px-4 py-1.5 rounded text-sm font-bold shadow-lg transition-colors ${exporting || engineState !== 'ready' ? 'bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-brand hover:bg-indigo-500'}`}
        >
          {exporting ? `⏳ 렌더링 ${progress}%` : '✨ 영상 완성하기 (Export)'}
        </button>
      </header>

      <main className="flex-1 flex p-3 gap-3 min-h-0">
        {/* 좌측: 모니터 + 타임라인 */}
        <section className="flex-1 flex flex-col gap-3 min-w-0">
          {/* 모니터 */}
          <div className="flex-1 bg-gray-950 rounded-lg border border-gray-800 flex flex-col min-h-0">
            <div ref={previewBoxRef} className="flex-1 min-h-0 flex items-center justify-center p-2">
              <div className="relative bg-black overflow-hidden ring-1 ring-gray-700" style={{ width: fitW - 8, height: fitH - 8 }}>
                {current ? (
                  current.clip.type === 'video' ? (
                    <video
                      ref={videoRef}
                      key={current.clip.url}
                      src={current.clip.url}
                      muted={mute}
                      playsInline
                      onLoadedMetadata={() => {
                        seekVideoToPlayhead();
                        if (S.current.playing) videoRef.current?.play().catch(() => {});
                      }}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <img src={current.clip.url} className="w-full h-full object-contain" alt="" />
                  )
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 text-sm">
                    <span className="text-3xl mb-2">🎬</span>소스를 가져와 주세요
                  </div>
                )}
                {caption.trim() && (
                  <div
                    className="absolute left-0 right-0 text-center font-bold text-white pointer-events-none px-2"
                    style={{
                      fontSize: capFont,
                      top: capPos === 'top' ? '12%' : capPos === 'center' ? '50%' : '88%',
                      transform: 'translateY(-50%)',
                      textShadow: '0 0 4px #000, 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000',
                    }}
                  >
                    {caption}
                  </div>
                )}
              </div>
            </div>
            {/* 트랜스포트 */}
            <div className="flex items-center justify-center gap-3 py-1.5 border-t border-gray-800 text-xs">
              <button onClick={() => { setPlaying(false); setPlayhead(0); }} className="px-2 py-1 bg-gray-800 rounded hover:bg-gray-700">⏮</button>
              <button onClick={() => { setPlaying(false); setPlayhead((p) => Math.max(0, p - 1 / FPS)); }} className="px-2 py-1 bg-gray-800 rounded hover:bg-gray-700">◀|</button>
              <button onClick={togglePlay} className="px-4 py-1 bg-brand rounded font-bold hover:bg-indigo-500">{playing ? '❚❚' : '▶'}</button>
              <button onClick={() => { setPlaying(false); setPlayhead((p) => Math.min(total, p + 1 / FPS)); }} className="px-2 py-1 bg-gray-800 rounded hover:bg-gray-700">|▶</button>
              <span className="font-mono text-brand ml-2">{tc(playhead)}</span>
              <span className="font-mono text-gray-500">/ {tc(total)}</span>
            </div>
          </div>

          {/* 타임라인 */}
          <div className="h-48 bg-gray-900 rounded-lg border border-gray-800 flex flex-col shrink-0 overflow-hidden">
            <div className="flex justify-between items-center px-3 py-1.5 border-b border-gray-800">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="font-semibold text-gray-300 mr-2">타임라인</span>
                <button onClick={setInAtPlayhead} className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700" title="단축키 I">[ 시작점 (I)</button>
                <button onClick={setOutAtPlayhead} className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700" title="단축키 O">끝점 (O) ]</button>
                <button onClick={splitAtPlayhead} className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700" title="단축키 S"><span className="text-red-400">✂</span> 자르기 (S)</button>
                <button onClick={deleteSelected} className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded hover:bg-red-900" title="단축키 Delete">🗑 삭제 (Del)</button>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <button onClick={() => setPps((p) => Math.max(5, p / 1.5))} className="px-2 py-0.5 bg-gray-800 rounded hover:bg-gray-700">－</button>
                <span className="text-gray-500">줌</span>
                <button onClick={() => setPps((p) => Math.min(200, p * 1.5))} className="px-2 py-0.5 bg-gray-800 rounded hover:bg-gray-700">＋</button>
                <button onClick={() => fileInputRef.current?.click()} className="ml-2 bg-brand hover:bg-indigo-500 font-bold px-2.5 py-0.5 rounded">+ 소스 가져오기</button>
                <input ref={fileInputRef} type="file" multiple accept="video/*,image/*" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* 트랙 헤더 */}
              <div className="w-10 bg-gray-800/80 border-r border-gray-700 flex flex-col shrink-0 text-[9px] font-bold">
                <div className="h-5 border-b border-gray-700" />
                <div className="h-6 flex items-center justify-center text-purple-400 border-b border-gray-700/50">T1</div>
                <div className="h-14 flex items-center justify-center text-blue-400 border-b border-gray-700/50">V1</div>
                <div className="h-8 flex items-center justify-center text-green-400">A1</div>
              </div>

              {/* 트랙 본문 */}
              <div className="flex-1 overflow-x-auto overflow-y-hidden">
                <div ref={trackRef} className="relative cursor-text" style={{ width: contentW }} onMouseDown={onTrackMouseDown}>
                  {/* 눈금자 */}
                  <div className="h-5 border-b border-gray-700 relative bg-gray-900">
                    {Array.from({ length: Math.ceil(rulerEnd / rulerStep) + 1 }).map((_, i) => (
                      <div key={i} className="absolute top-0 h-full border-l border-gray-600" style={{ left: i * rulerStep * pps }}>
                        <span className="absolute top-0 left-1 text-[9px] text-gray-500 font-mono">{tc(i * rulerStep).slice(0, 5)}</span>
                      </div>
                    ))}
                  </div>

                  {/* T1 자막 */}
                  <div className="h-6 border-b border-gray-800/50 relative">
                    {caption.trim() && total > 0 && (
                      <div className="absolute top-0.5 bottom-0.5 left-0 bg-purple-600/70 border border-purple-400 rounded-sm px-2 text-[9px] flex items-center truncate" style={{ width: total * pps }}>
                        T {caption}
                      </div>
                    )}
                  </div>

                  {/* V1 영상 */}
                  <div className="h-14 border-b border-gray-800/50 relative">
                    {!clips.length && <div className="absolute inset-0 flex items-center pl-4 text-[10px] text-gray-600">+ 소스 가져오기로 영상/사진을 올리면 여기에 순서대로 붙습니다</div>}
                    {timeline.map(({ clip, start, end }) => (
                      <div
                        key={clip.id}
                        className={`absolute top-0.5 bottom-0.5 rounded-sm border overflow-hidden ${selectedId === clip.id ? 'border-yellow-400 ring-1 ring-yellow-400 z-10' : clip.type === 'image' ? 'border-amber-700' : 'border-blue-700'} ${clip.type === 'image' ? 'bg-amber-900/40' : 'bg-blue-900/40'}`}
                        style={{ left: start * pps, width: Math.max(4, (end - start) * pps) }}
                      >
                        {clip.type === 'video' ? (
                          <video src={`${clip.url}#t=${clip.inPoint + 0.05}`} muted preload="metadata" className="h-full w-auto opacity-60 pointer-events-none" />
                        ) : (
                          <img src={clip.url} className="h-full w-auto opacity-60 pointer-events-none" alt="" />
                        )}
                        <div className="absolute top-0 left-2 right-2 text-[9px] truncate text-white/90 drop-shadow pointer-events-none">
                          {clip.type === 'image' ? '🖼 ' : '🎞 '}{clip.name}
                        </div>
                        <div className="absolute bottom-0 left-2 text-[8px] font-mono text-white/70 pointer-events-none">{tc(end - start)}</div>
                        {/* 트리밍 핸들 */}
                        <div onMouseDown={(e) => onHandleMouseDown(e, clip, 'L')} className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-yellow-400/0 hover:bg-yellow-400/80" />
                        <div onMouseDown={(e) => onHandleMouseDown(e, clip, 'R')} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-yellow-400/0 hover:bg-yellow-400/80" />
                      </div>
                    ))}
                  </div>

                  {/* A1 오디오 */}
                  <div className="h-8 relative">
                    {timeline.map(({ clip, start, end }) => (
                      <div
                        key={'a' + clip.id}
                        className={`absolute top-0.5 bottom-0.5 rounded-sm border ${mute || clip.type === 'image' ? 'border-gray-700 bg-gray-800/40' : 'border-green-800 bg-green-900/40'}`}
                        style={{ left: start * pps, width: Math.max(4, (end - start) * pps) }}
                      >
                        <span className="text-[8px] pl-1 text-gray-400">{mute ? '음소거' : clip.type === 'image' ? '무음' : '♪'}</span>
                      </div>
                    ))}
                  </div>

                  {/* 플레이헤드 */}
                  {clips.length > 0 && (
                    <div className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none" style={{ left: playhead * pps }}>
                      <div className="absolute -top-0 -left-[5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-transparent border-t-red-500" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 우측: 설정 */}
        <aside className="w-64 bg-gray-900 rounded-lg border border-gray-800 p-4 flex flex-col gap-4 overflow-y-auto shrink-0 text-xs">
          <div>
            <h2 className="font-bold text-gray-400 mb-2">화면 비율</h2>
            <div className="grid grid-cols-3 gap-1.5">
              {([['16:9', '유튜브', 'w-8 h-4'], ['9:16', '릴스/쇼츠', 'w-4 h-8'], ['1:1', '인스타피드', 'w-6 h-6']] as const).map(([r, label, box]) => (
                <button key={r} onClick={() => setRatio(r)} className={`flex flex-col items-center gap-1.5 p-2 rounded-md border ${ratio === r ? 'bg-brand/20 border-brand text-brand' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}>
                  <div className={`${box} border-2 border-current rounded-sm`} />
                  <span className="text-[9px] font-bold">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-gray-800" />

          {selected ? (
            <div className="bg-gray-800/50 p-3 rounded-md border border-gray-700 flex flex-col gap-2">
              <h2 className="text-[10px] font-bold text-brand">선택된 클립</h2>
              <p className="truncate text-gray-300">{selected.name}</p>
              <div className="font-mono text-[10px] text-gray-400 leading-5">
                {selected.type === 'video' && <>IN {tc(selected.inPoint)} · OUT {tc(selected.outPoint)}<br /></>}
                길이 {tc(selected.outPoint - selected.inPoint)}
              </div>
              {selected.type === 'image' && (
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-gray-400">사진 노출 시간: {(selected.outPoint - selected.inPoint).toFixed(1)}초</span>
                  <input type="range" min={0.5} max={15} step={0.5} value={selected.outPoint - selected.inPoint} onChange={(e) => setImageDuration(Number(e.target.value))} className="accent-[#6366f1]" />
                </label>
              )}
              <div className="flex gap-1">
                <button onClick={() => moveSelected(-1)} className="flex-1 py-1 bg-gray-800 rounded hover:bg-gray-700">◀ 앞으로</button>
                <button onClick={() => moveSelected(1)} className="flex-1 py-1 bg-gray-800 rounded hover:bg-gray-700">뒤로 ▶</button>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-gray-500 text-center">타임라인에서 클립을 클릭하세요</p>
          )}

          <div className="h-px bg-gray-800" />

          <div>
            <h2 className="font-bold text-gray-400 mb-2">홍보 자막 (전체 구간)</h2>
            <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="예: 오늘의 특가 신상 입고!" className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:border-brand" />
            <div className="flex gap-1 mt-1.5">
              {([['top', '상단'], ['center', '중앙'], ['bottom', '하단']] as const).map(([p, l]) => (
                <button key={p} onClick={() => setCapPos(p)} className={`flex-1 py-1 rounded text-[10px] ${capPos === p ? 'bg-brand' : 'bg-gray-800 hover:bg-gray-700'}`}>{l}</button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 p-2.5 bg-gray-800 rounded-md cursor-pointer hover:bg-gray-700">
            <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} />
            <span>현장 소리 끄기 (음소거)</span>
          </label>

          <div className="mt-auto text-[10px] text-gray-500 leading-5 border-t border-gray-800 pt-3">
            <b className="text-gray-400">단축키</b><br />
            Space 재생/정지 · ←/→ 1프레임<br />
            I 시작점 · O 끝점 · S 자르기 · Del 삭제<br />
            클립 양 끝을 마우스로 끌면 트리밍
          </div>
        </aside>
      </main>

      {/* 렌더링 진행창 */}
      {exporting && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-96">
            <h3 className="font-bold mb-1">영상 굽는 중... {progress}%</h3>
            <p className="text-xs text-gray-400 mb-3">{status}</p>
            <div className="h-2 bg-gray-800 rounded overflow-hidden">
              <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-[10px] text-gray-500 mt-3">창을 닫거나 새로고침하지 마세요. 노트북 사양에 따라 1분 영상 기준 수 분이 걸릴 수 있습니다.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
