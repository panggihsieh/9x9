# 第三版：Firebase 班級測驗

第三版已整合至專案主分支，提供 Kahoot 式班級代碼登入與老師監控 dashboard。線上入口：https://x9-factor-game.web.app/

## 功能

- 老師輸入 Gmail，免登入查詢 admin 設定的優先權；列入老師名單後可建立或開啟班級代碼。
- 老師身分分為 admin（最高管理者）、auth（已核准優先）與 guest（最低優先）；全站同時上線達 100 人時，guest 暫停開新班級。
- 學生輸入班級代碼與姓名加入。
- 班級最多 100 位學生，超過會禁止加入。
- 老師畫面顯示登入人數，可按「開始練習」讓學生進入個人測驗。
- 學生進入第二版概念的個人練習畫面，完成因數、因數配對、質因數分解三項。
- 老師 dashboard 即時顯示每位學生的 1、2、3 項完成狀態、分數與前 5 名。
- 老師按「結束班級」會清空 Firestore 中該班級資料。
- 後台僅限 `teacher-access.js` 指定的最高管理者，可新增、調整與移除老師名單及優先權。

## 設定 Firebase

1. 建立 Firebase 專案。
2. 開啟 Firestore Database。
3. 開啟 Authentication 的 Google 登入。
4. 複製 `firebase-config.example.js` 為 `firebase-config.js`，填入你的 Firebase 專案設定。
5. 將 `firestore.rules` 發布到 Firestore Rules。

目前 `firebase-config.js` 已設定為 `x9-factor-game` 專案；另建專案時請換成自己的設定，並同步修改 `teacher-access.js` 與 Firestore Rules 中的最高管理者 Email。

老師端的 Email 查詢只用於班級優先權，不代表 Google 身分驗證，也不會取得後台管理權限。Firestore Rules 允許依單一 Email 查詢名單，只有經 Google 驗證的最高管理者可列出或修改名單。班級資料目前仍採開放讀寫規則。

## 本機測試

在專案根目錄啟動靜態伺服器後開啟：

```bash
python -m http.server 8080
```

然後前往：

```text
http://localhost:8080/v3/
```
