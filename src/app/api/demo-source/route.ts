import { NETWORKING_FIXTURE, NETWORKING_FIXTURE_EN, NETWORKING_FIXTURE_NAME, NETWORKING_FIXTURE_NAME_EN } from "@/fixtures/networking";

export async function GET(request: Request) {
  const spanish = new URL(request.url).searchParams.get("locale") === "es";
  return Response.json({ name: spanish ? NETWORKING_FIXTURE_NAME : NETWORKING_FIXTURE_NAME_EN, text: spanish ? NETWORKING_FIXTURE : NETWORKING_FIXTURE_EN });
}
