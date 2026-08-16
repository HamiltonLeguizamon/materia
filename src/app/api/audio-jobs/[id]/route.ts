import { selectiveAudioService } from "@/server/container";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const job = await selectiveAudioService.getJob((await context.params).id);
    return job ? Response.json({ job }) : Response.json({ error: "The audio job does not exist." }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}
