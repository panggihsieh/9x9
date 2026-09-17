# 第三版：個人開課與全班同步比賽

直接開啟 https://panggihsieh.github.io/9x9/v3/ 。首頁不提供第三版入口，但網址並非私人存取限制。

## 開課與管理

選擇教室模式、輸入班級代碼即可開課。開課沿用 Firebase 匿名登入，班級所有權由 `teacherUid` 核對；不再使用 Gmail、四碼通行碼、驗證嘗試或驗證紀錄。原有班級保留；同一 Firebase 身分可管理自己建立的班級。舊身分建立的班級需由原身分或管理員處理，或等雙方閒置五分鐘後重用。

後台仍只允許 Google 驗證的 `teacher.hsieh@gmail.com` 管理班級。舊老師名單與驗證集合已關閉客戶端讀寫，保留資料、不執行資料刪除。使用匿名登入不代表只有站主能開課。

學生以代碼及姓名加入，每班上限 100 人。成績每 15 秒合併同題進度，換題前與時間到會補送；只由老師查詢前 10 名。斷線未同步資料保存在原裝置。開始、釋放、計分與防重複規則仍由 Firestore 檢查。

## 開發與發布

使用 Firebase Authentication 的 Anonymous 與 Google 提供者、Firestore 與 Hosting，不需要 Cloud Functions。測試優先使用本機模擬器，避免消耗正式配額。

```powershell
node --test tests/*.test.cjs tests/*.test.mjs
npx --yes firebase-tools@13.35.1 emulators:exec --config firebase.emulators.json --only firestore,auth --project demo-factor-game "node tests/firestore-live.cjs"
npx firebase-tools deploy --only "firestore,hosting" --project x9-factor-game
```

上述模擬器指令搭配 Java 17；新版 Firebase CLI 的 Java 要求請依其版本設定。本機預覽：`python -m http.server 8765`。

詳細節省用量的原因、同步與補傳限制，請見專案根目錄 README 的精簡排行榜模式說明。
