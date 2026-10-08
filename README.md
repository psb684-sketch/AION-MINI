<div align="center">

<img src="public/favicon.svg" width="96" alt="AION MINI 로고" />

# AION MINI

**설치 없이 브라우저에서 바로 쓰는 유튜브 · 인스타그램 릴스용 초경량 영상 편집기**

[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1.svg)](LICENSE)
[![Deploy](https://github.com/psb684-sketch/AION-MINI/actions/workflows/deploy.yml/badge.svg)](https://github.com/psb684-sketch/AION-MINI/actions/workflows/deploy.yml)

### 👉 [지금 바로 사용하기](https://psb684-sketch.github.io/AION-MINI/) 👈

</div>

---

## 📌 소개

AION MINI는 **"옛날 윈도우 무비메이커처럼 쉽게, 하지만 방송 편집기처럼 손에 익게"** 를 목표로 만든 웹 영상 편집기입니다.

- **설치가 필요 없습니다.** 크롬 / 엣지에서 링크만 열면 바로 편집할 수 있습니다.
- **영상이 서버로 올라가지 않습니다.** 모든 렌더링은 내 PC의 브라우저 안에서 처리되므로 개인정보와 영업 자료가 외부로 나가지 않습니다.
- **저사양 노트북(RAM 4GB)을 기준으로 설계했습니다.** 사무용 노트북에서도 무리 없이 돌아가도록 꼭 필요한 기능만 넣었습니다.

## ✨ 주요 기능

| 기능 | 설명 |
|---|---|
| 🎞 **영상 + 사진 이어붙이기** | MP4 / MOV 영상과 JPG / PNG 사진을 타임라인에 순서대로 올려 하나의 영상으로 만듭니다 |
| ✂ **컷 편집** | 재생선 위치에서 자르기(S), 시작점(I) / 끝점(O) 지정, 클립 양 끝을 마우스로 끌어 트리밍 |
| 📐 **원클릭 화면 비율** | 유튜브 16:9 · 릴스/쇼츠 9:16 · 인스타 피드 1:1 (여백은 검정색으로 자동 채움) |
| 🅣 **홍보 자막** | 상단 / 중앙 / 하단 위치 선택, 미리보기 화면 그대로 영상에 새겨집니다 |
| 🔇 **음소거** | 현장 소음이나 기계 소리를 한 번에 끕니다 |
| 🖼 **사진 노출 시간** | 사진 한 장당 0.5초 ~ 15초 |
| 📺 **NLE 스타일 타임라인** | T1(자막) · V1(영상) · A1(오디오) 트랙, 타임코드(MM:SS:FF), 재생선 스크러빙, 줌 |
| 💾 **MP4 내보내기** | H.264 + AAC 표준 MP4로 저장되어 유튜브 / 인스타그램에 바로 업로드할 수 있습니다 |

## ⌨️ 단축키

| 키 | 동작 |
|---|---|
| `Space` | 재생 / 정지 |
| `←` / `→` | 1프레임 이동 |
| `I` | 재생선 위치를 클립 시작점으로 |
| `O` | 재생선 위치를 클립 끝점으로 |
| `S` | 재생선 위치에서 클립 자르기 |
| `Delete` | 선택한 클립 삭제 (뒤 클립이 자동으로 당겨짐) |

## 🚀 사용 방법

1. **[사용하기 링크](https://psb684-sketch.github.io/AION-MINI/)** 를 크롬 또는 엣지로 엽니다.
2. 상단에 **"● 렌더링 엔진 준비완료"** (초록색)가 뜰 때까지 잠시 기다립니다. *(처음 한 번 약 30MB의 엔진을 내려받습니다)*
3. **`+ 소스 가져오기`** 로 영상과 사진을 올립니다.
4. 자르고, 순서를 정하고, 화면 비율과 자막을 고릅니다.
5. **`✨ 영상 완성하기`** 를 누르면 완성된 MP4가 다운로드 폴더에 저장됩니다.

## ⚠️ 알아두실 점

- **권장 길이는 1 ~ 5분입니다.** 브라우저가 메모리 안에서 처리하므로, RAM 4GB 노트북에서 10분이 넘는 영상은 느리거나 실패할 수 있습니다.
- **렌더링 속도:** PC 사양에 따라 1분짜리 영상에 수 분이 걸릴 수 있습니다. 진행 중에는 창을 닫지 마세요.
- **WMV 등 오래된 형식**은 브라우저에서 미리보기가 안 될 수 있습니다. MP4 / MOV를 권장합니다.
- 렌더링 엔진을 인터넷에서 불러오므로 **인터넷 연결이 필요합니다.**
- 아직 완성작이 아니라 프로토 타입입니다.

## 🛠 개발자용 - 내 PC에서 실행하기

[Node.js](https://nodejs.org/) 20 이상이 필요합니다.

```bash
git clone https://github.com/psb684-sketch/AION-MINI.git
cd AION-MINI
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 을 엽니다. `main` 브랜치에 push하면 GitHub Actions가 자동으로 빌드해 GitHub Pages에 배포합니다.

### 기술 스택

- **React 19 + TypeScript + Vite** - 화면
- **Tailwind CSS 4** - 디자인
- **[FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)** - 브라우저 안에서 동작하는 영상 처리 엔진

## 📄 라이선스

[MIT License](LICENSE) © 2026 psb684-sketch

영상 처리 엔진으로 [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) (MIT)과 [FFmpeg](https://ffmpeg.org/) (LGPL / GPL)을 사용합니다. 엔진 파일은 이 저장소에 포함되어 있지 않으며, 실행할 때 CDN에서 불러옵니다.
