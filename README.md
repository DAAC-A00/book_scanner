# 장서점검 스캐너 (Book Scanner PWA)

도서관 장서점검용 **고속 바코드 스캐너**입니다. Next.js 기반 PWA로 모바일 브라우저에서 설치 없이 사용하거나 홈 화면에 추가할 수 있습니다.

## 주요 기능

- **장서점검 시작** — 진입 직후 카메라는 꺼짐. 버튼을 눌러 세션을 연 뒤에만 `html5-qrcode`가 동작.
- **세션 키 = 시작 시각** — `localStorage` 키는 `book-scanner:session:` + ISO8601(점검 시작 일시). 한 세션의 모든 스캔은 그 키 하나의 값에 줄바꿈으로 누적.
- **스캔 즉시 저장** — 유효한 숫자가 인식될 때마다 `localStorage`에 바로 append. 점검 중단 시 일괄 저장하지 않음.
- **점검 중단** — 확인 팝업 없이 즉시 세션 종료 후 첫 화면으로 복귀.
- **메인 정리** — 메인으로 들어올 때 바코드 0건인 세션은 `removeSessionKeysWithZeroBarcodes()`로 제거 후 건수·목록 반영.
- **지난 점검 기록** — 목록에서 항목을 열어 상세의 textarea로 조회·수정·삭제. **클립보드 복사는 상세에서만**(목록 행·점검 중 화면에서는 복사 없음).
- **점검 중 표시** — 하단 누적 줄은 읽기 전용(스캔으로만 갱신).
- **연속 스캔** — 세션 유지 중 바코드만 비추면 반복 인식(별도 셔터 없음).
- **숫자만 기록** — `trim` 후 `/^\d+$/` 통과 시에만 저장.
- **피드백** — 진동(지원 기기), 테두리 녹색 플래시, 토스트, Web Audio 비프(`useScanBeeps`).
- **라이브 표시** — 스캔 중 권수·「방금 인식」대형 숫자 + 강조 애니메이션.
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
- `src/components/Scanner.tsx` — 카메라/목업, 라이브 패널, 읽기 전용 누적 영역, 토스트, 비프 훅 연동
- `src/store/useScannerStore.ts` — 세션 생명주기, `localStorage` append/동기, 세션 키·빈 세션 정리 유틸
- `src/hooks/useScanBeeps.ts` — 스캔 성공/실패 짧은 톤
- `public/manifest.json` — PWA 메타데이터

자세한 요구·로드맵은 [PRD.md](./PRD.md)를 참고하세요.

## 배포 (Vercel)

프로덕션 빌드에서 PWA 플러그인이 서비스 워커를 생성합니다.

### `main` 푸시 시 자동 배포 (권장)

수동으로 Deployments에서 “Create Deployment” 할 필요 없이, **Git 저장소만 Vercel에 연결**하면 `main`에 푸시할 때마다 프로덕션 배포가 자동으로 진행됩니다.

1. [Vercel 대시보드](https://vercel.com/dashboard) → **Add New…** → **Project** (또는 기존 프로젝트 선택).
2. **Import Git Repository**에서 이 저장소(GitHub/GitLab/Bitbucket)를 선택하고 **Import**합니다.  
   - 이미 프로젝트만 있고 Git이 비어 있다면: 해당 프로젝트 **Settings** → **Git** → **Connect Git Repository**로 같은 작업을 합니다.
3. Framework Preset이 **Next.js**로 잡혀 있는지 확인하고 **Deploy**를 누릅니다.
4. 이후 **`main` 브랜치에 push(또는 merge)** 할 때마다 Vercel이 자동으로 빌드·배포합니다. Production Branch는 기본값이 `main`입니다 (**Settings** → **Git** → **Production Branch**).

별도 GitHub Actions 없이 위 연결만으로 `main` 푸시 → 자동 배포가 완료됩니다.

### 참고

조직 정책 등으로 Vercel–Git 연결이 불가하고 CI에서만 배포해야 한다면, Vercel 문서의 **“Deploying with GitHub Actions”**를 따라 저장소 시크릿과 워크플로를 직접 구성하면 됩니다. 일반적인 경우는 위 Git 연결이 가장 단순합니다.

## 참고

- 스캔 데이터는 **브라우저·기기별** `localStorage`에만 존재합니다. 다른 기기와 자동 동기화되지 않습니다.
