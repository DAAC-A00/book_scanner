# 장서점검 스캐너 (Book Scanner PWA)

도서관 장서점검용 **고속 바코드 스캐너**입니다. Next.js 기반 PWA로 모바일 브라우저에서 설치 없이 사용하거나 홈 화면에 추가할 수 있습니다.

## 주요 기능

- **장서점검 시작** — 진입 직후 카메라는 꺼짐. 버튼을 눌러 세션을 연 뒤에만 `html5-qrcode`가 동작.
- **세션 키 = 시작 시각** — `localStorage` 키는 `book-scanner:session:` + ISO8601(점검 시작 일시). 한 세션의 모든 스캔은 그 키 하나의 값에 줄바꿈으로 누적.
- **스캔 즉시 저장** — 유효한 숫자가 인식될 때마다 `localStorage`에 바로 append. 점검 중단 시 일괄 저장하지 않음.
- **시작 전 이력** — 같은 접두사의 과거 세션을 목록으로 보고, textarea에서 수정하거나 삭제.
- **연속 스캔** — 세션 유지 중 바코드만 비추면 반복 인식(별도 셔터 없음).
- **숫자만 기록** — `trim` 후 `/^\d+$/` 통과 시에만 저장.
- **피드백** — 진동(지원 기기), 테두리 녹색 플래시, 하단 토스트.
- **라이브 표시** — 스캔 중 「방금 인식」 대형 표시 + 최근 줄 목록 + 강조 애니메이션.
- **점검 중 편집** — 하단 textarea로 이번 세션 본문 수정 시에도 동일 키에 즉시 반영.
- **데스크톱** — 터치 환경이 아니면 가상 숫자 스캔으로 테스트.

## 기술 스택

| 영역 | 사용 |
|------|------|
| 프레임워크 | Next.js 16 (App Router), React 19 |
| 스타일 | Tailwind CSS 4 |
| 스캐너 | html5-qrcode |
| 상태 | Zustand 5 (세션/UI 런타임; 스캔 본문은 persist 없음) |
| 저장소 | `localStorage` (세션별 키, `useScannerStore.ts` 헬퍼) |
| PWA | @ducanh2912/next-pwa |

## 시작하기

```bash
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 엽니다. 개발 모드에서는 PWA 서비스 워커가 비활성화되어 있습니다.

## 빌드

```bash
npm run build
npm start
```

## 프로젝트 구조 (요약)

- `src/app/` — App Router 레이아웃·페이지
- `src/components/Scanner.tsx` — 카메라/목업, 이력 UI, 라이브 패널, 토스트
- `src/store/useScannerStore.ts` — 세션 생명주기, `localStorage` append/동기, 세션 키 유틸
- `public/manifest.json` — PWA 메타데이터

자세한 요구·로드맵은 [PRD.md](./PRD.md)를 참고하세요.

## 배포

[Vercel](https://vercel.com) 등에 Next 앱으로 배포하면 됩니다. 프로덕션 빌드에서 PWA 플러그인이 서비스 워커를 생성합니다.

## 참고

- 스캔 데이터는 **브라우저·기기별** `localStorage`에만 존재합니다. 다른 기기와 자동 동기화되지 않습니다.
