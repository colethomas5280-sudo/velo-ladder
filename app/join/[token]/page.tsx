import JoinForm from "@/components/JoinForm";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="wrap">
      <div className="appbar">
        <span className="mark">
          <span className="dot" />
          Velo Ladder
        </span>
      </div>
      <JoinForm token={token} />
    </div>
  );
}
