# 호박마켓 (Hobak)

우리 동네 중고거래 웹 애플리케이션입니다. 정적 HTML/CSS/JavaScript와 Supabase를 기반으로 동작합니다.

## 주요 기능

- **상품 목록 (`index.html`)**: 검색, 지역/카테고리/거래상태 필터링, 정렬, 인기 검색어 태그, 페이지네이션
- **상품 상세 (`detail.html`)**: 이미지 캐러셀, 관심(찜) 토글, 채팅 메시지, 작성자 전용 거래상태 변경(판매중/예약중/거래완료)·수정·삭제
- **글쓰기/수정 (`write.html`)**: 이미지 리사이징 및 Supabase Storage 업로드, 임시저장, 미리보기, 유효성 검사
- **회원 인증 (`js/auth.js`)**: Supabase Auth 기반 이메일 로그인/회원가입 및 프로필 연동

## 프로젝트 구조

```text
hobak/
├── index.html            # 메인 상품 목록 페이지
├── detail.html           # 상품 상세 페이지
├── write.html            # 게시글 작성 및 수정 페이지
├── css/                  # 디자인 토큰 및 페이지별 스타일시트
├── js/                   # Supabase 연동, 인증, 목록/상세/작성 로직
└── assets/products/      # 샘플 상품 SVG 이미지
```

## 로컬 실행

정적 파일 서버로 실행할 수 있습니다.

```bash
npx serve .
```

또는 VS Code Live Server 등 정적 웹 서버로 `index.html`을 열어 확인할 수 있습니다.

## 배포 전 확인 사항

- **환경 파일**: `.env` 파일은 `.gitignore`에 포함되어 저장소에 업로드되지 않습니다.
- **Supabase Auth URL 설정**: GitHub Pages 등으로 배포한 뒤 Supabase Dashboard → Authentication → URL Configuration에서 Site URL 및 Redirect URLs에 배포 주소를 등록하세요.
- **Supabase 보안 권고**: 운영 환경 전환 시 `SECURITY DEFINER` RPC 함수의 익명(`anon`) 실행 권한 제한 및 Auth 유출 비밀번호 보호(Leaked Password Protection) 활성화를 검토하세요.
