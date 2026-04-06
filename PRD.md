# 📚 Project: High-Speed Library Inventory PWA

## 1. 개요 (Overview)
본 프로젝트는 도서관 장서점검 업무의 병목 현상을 해결하기 위한 **고속 바코드 스캐닝 모바일 웹 PWA**입니다. 별도의 앱 설치 없이 브라우저에서 즉시 구동되며, 연속적인 스캔과 데이터 자동 처리에 최적화되어 있습니다.

## 2. 사용자 스토리 (User Stories)
- **작업자:** "나는 수천 권의 책을 스캔해야 하므로, 매번 버튼을 누르지 않고도 바코드를 갖다 대기만 하면 자동으로 인식되어야 한다."
- **관리자:** "네트워크가 불안정한 서고 깊숙한 곳에서도 스캔 데이터가 유실되지 않고 로컬에 저장되었다가 나중에 동기화되어야 한다."

## 3. 핵심 기능 (Core Features)
### ① Continuous Scanner (Headless UI)
- `html5-qrcode` 기반의 고속 스캐닝 엔진.
- 화면 전체를 뷰파인더로 활용하여 조준 편의성 증대.
- 후면 카메라 자동 고정 및 오토포커스 최적화.

### ② Shadow Scan (Offline-First)
- 네트워크 상태와 무관하게 `Zustand`와 `LocalStorage`에 즉시 저장.
- 스캔 즉시 텍스트(숫자) 추출 및 클립보드 자동 복사 기능.

### ③ Multi-Sensory Feedback
- 스캔 성공 시 짧은 진동(Haptic) 발생.
- 화면 테두리 녹색 플래시(Visual) 효과.
- 성공/오류 시 서로 다른 비프음(Audio) 출력.

## 4. 기술 스택 (Tech Stack)
- **Frontend:** Next.js 15 (App Router), Tailwind CSS
- **PWA:** @ducanh2912/next-pwa
- **State:** Zustand (with Persist middleware)
- **Utility:** date-fns (스캔 시간 기록용)

## 5. UI/UX 전략
- **Apple-style:** 미니멀한 디자인과 산프란시스코 폰트 계열 사용.
- **Dark Mode Default:** 현장 작업 시 배포 소모 절감을 위해 블랙 배경 권장.
- **One-hand Control:** 하단 배치 컨트롤 레이아웃.

## 6. 성공 지표 (Success Metrics)
- 권당 스캔 및 데이터 저장 처리 시간 1초 미만.
- 오프라인 환경에서의 데이터 보존율 100%.