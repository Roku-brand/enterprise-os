export default function NotAuthorized() {
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
    <section style={{ maxWidth: 520, textAlign: "center" }}>
      <h1>この組織へのアクセス権がありません</h1>
      <p>組織オーナーのChatGPTアカウントでサインインしてください。</p>
      <a href="/signout-with-chatgpt?return_to=/">別のアカウントでサインイン</a>
    </section>
  </main>;
}
