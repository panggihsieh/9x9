# 第三版：全班因數挑戰

線上入口：https://x9-factor-game.web.app/v3/

## 老師驗證

畫面提供 `gmail` 與 `passcode` 兩個欄位。通行碼為 4 位數字，可含前導零，例如 `0037`。admin 透過 Google 登入後台，為每位老師設定或重設通行碼。首次設定必填，編輯留白則保留原碼。

通行碼儲存在原有 Firestore `admins/{email}` 文件的 `passcode` 欄位（字串）。只有 Google 驗證的最高管理者可以讀寫老師文件；一般網頁不會下載老師名單或正確通行碼。通行碼以明碼存於受限文件，不是雜湊；有資料庫管理權限的人可以讀取。

老師驗證使用 Firebase 匿名身分綁定操作，由 Firestore Security Rules 比對 gmail 與 passcode。先記錄候選通行碼，再依規則建立驗證紀錄；不能直接跳過步驟取得 auth。同一 Gmail 每 15 分鐘最多嘗試 5 次（包括成功驗證），兩次嘗試間隔至少 2 秒。錯碼或無名單顯示 guest，不授予優先等級，也不能開課。

驗證有效 8 小時；重設通行碼、更新權限或移除老師後，舊驗證失效。重新整理後需再驗證。開課、開始及結束教室由 Firestore 規則檢查有效驗證與教室所有權。學生仍以班級代碼及姓名加入，保留既有免登入作答流程。

這是四碼存取驗證，不證明 Gmail 帳號所有權。每帳號的嘗試限制也可能被他人耗盡，造成暫時無法驗證。Spark 額度限制仍適用。

## 設定與部署

使用既有 Firebase Spark 專案，無需 Cloud Functions、Blaze 或其他後端。Authentication 啟用 Google（admin）與 Anonymous（老師驗證綁定），Firestore 儲存老師及班級資料。

```powershell
node --test tests/frontend.test.cjs
npx firebase-tools deploy --only "firestore:rules,hosting" --project x9-factor-game
```

既有老師不會被設定共用預設碼。admin 須至後台逐一設定 4 位數字；admin 若要在老師端開課，也須設定自己的通行碼。原名單未設定通行碼時無法驗證。

遠端回歸測試（使用本機已登入 Firebase CLI；建立並清除獨立測試紀錄）：

```powershell
$env:RUN_FIRESTORE_LIVE='x9-factor-game'
node tests/firestore-live.cjs
```

測試覆蓋通行碼隱私、越權、錯碼、正確碼、前導零、嘗試限制、教室權限與通行碼重設撤銷。驗證嘗試每個 email 一筆、驗證紀錄每個 uid 一筆；過期資料不會繼續授權，可定期清理。

本機預覽：`python -m http.server 8765`，開啟 http://localhost:8765/v3/ 。
