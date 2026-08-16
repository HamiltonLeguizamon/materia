import type { SpeechProvider, TeachingPlanProvider } from "@/application/ports";
import type { CreateLessonInput, TeachingPlan } from "@/domain/teaching";
import { migrateTeachingPlan, teachingPlanSchema, type TeachingBlockKind } from "@/domain/teaching";

const LEGACY_NETWORKING_TEACHING_PLAN = {
  title: "Fundamentos de redes: del paquete a la ruta",
  summary: "Una explicación guiada de cómo las capas, las direcciones y las decisiones de enrutamiento cooperan para mover información entre redes.",
  objectives: [
    "Explicar por qué la comunicación se divide en capas.",
    "Distinguir conmutación local de enrutamiento entre redes.",
    "Seguir el recorrido razonado de un paquete y diagnosticar fallos básicos.",
  ],
  requiredConcepts: ["paquete", "encapsulación", "TCP/IP", "subred", "puerta de enlace", "tabla de enrutamiento"],
  references: [
    { id: "source-1", label: "Paquetes y comunicación", excerpt: "La información se divide en paquetes que incluyen datos de control y una porción del contenido.", startLine: 3, endLine: 3 },
    { id: "source-2", label: "Capas y encapsulación", excerpt: "Las capas colaboran mediante interfaces definidas, por lo que una tecnología puede cambiar sin rediseñar toda la comunicación.", startLine: 7, endLine: 11 },
    { id: "source-3", label: "Direcciones y subredes", excerpt: "El prefijo determina qué destinos se consideran locales y cuáles necesitan una puerta de enlace.", startLine: 15, endLine: 17 },
    { id: "source-4", label: "Conmutación y enrutamiento", excerpt: "Un router consulta una tabla de enrutamiento y elige la coincidencia de prefijo más específica.", startLine: 21, endLine: 23 },
    { id: "source-5", label: "Diagnóstico razonado", excerpt: "Diagnosticar por capas evita cambios al azar y permite acotar fallos.", startLine: 27, endLine: 27 },
  ],
  chapters: [
    {
      id: "chapter-1", title: "Cómo viaja un paquete", purpose: "Construir un mapa mental del recorrido de la información.", estimatedMinutes: 4,
      referenceIds: ["source-1", "source-4"],
      keyPoints: ["La información se fragmenta en paquetes.", "Cada salto decide solamente el siguiente paso.", "Los datos de control hacen posible la entrega."],
      narration: "Imagina que envías una página web desde tu portátil. La información no cruza la red como una pieza indivisible. Se reparte en paquetes, y cada paquete añade datos de control que indican de dónde viene, adónde va y cómo debe tratarse. Dentro de la red local, un conmutador utiliza direcciones físicas para acercarlo a la puerta de enlace. El router retira la envoltura local, examina la dirección IP de destino y consulta su tabla de rutas. No necesita conocer el viaje completo: solo elegir el siguiente salto más adecuado. Otros routers repiten esa decisión hasta alcanzar la red de destino. Allí, el proceso se invierte y la aplicación recibe el contenido. Esta separación permite que un tramo use wifi, otro fibra y otro Ethernet sin cambiar el significado del mensaje.",
    },
    {
      id: "chapter-2", title: "Capas que ordenan la red", purpose: "Entender cómo las capas reducen complejidad y separan responsabilidades.", estimatedMinutes: 5,
      referenceIds: ["source-2"],
      keyPoints: ["TCP/IP divide responsabilidades claras.", "Cada capa usa servicios de la inferior.", "La separación facilita evolución y diagnóstico."],
      narration: "Internet funciona gracias a una arquitectura en capas. Cada capa tiene una responsabilidad específica y se comunica con la superior y la inferior mediante reglas definidas. La capa de aplicación ofrece servicios a los programas, como HTTP o DNS. La capa de transporte, con TCP o UDP, se ocupa de la comunicación extremo a extremo. La capa de Internet usa IP para el direccionamiento lógico y el enrutamiento. Debajo, la capa de acceso prepara tramas y bits para el medio físico. Al bajar por esta pila, cada nivel añade información de control; es la encapsulación. Separar en capas simplifica el diseño, permite que tecnologías distintas convivan y ayuda a diagnosticar problemas. Si puedes alcanzar una dirección IP pero no un nombre, por ejemplo, la conectividad básica funciona y conviene investigar DNS, no sustituir el cable.",
    },
    {
      id: "chapter-3", title: "Direcciones y subredes", purpose: "Relacionar prefijos, destinos locales y puerta de enlace.", estimatedMinutes: 4,
      referenceIds: ["source-3"],
      keyPoints: ["IPv4 usa 32 bits.", "El prefijo separa red y host.", "Los destinos externos pasan por la puerta de enlace."],
      narration: "Una dirección IPv4 contiene treinta y dos bits, aunque la escribimos como cuatro números. El prefijo, como el veinticuatro de 192.168.10.0 barra 24, indica cuántos bits identifican la red. El equipo aplica ese prefijo tanto a su dirección como a la de destino. Si coinciden, intenta entregar los datos directamente dentro de la red local. Si no coinciden, los envía a su puerta de enlace. Por eso la máscara no es un simple dato administrativo: cambia la decisión de entrega. Las subredes organizan equipos, limitan tráfico de difusión y permiten políticas diferenciadas. Una dirección correcta con un prefijo incorrecto puede aislar un equipo aunque el enlace físico parezca funcionar.",
    },
    {
      id: "chapter-4", title: "Elegir una ruta", purpose: "Interpretar cómo un router selecciona el siguiente salto y cómo comprobarlo.", estimatedMinutes: 4,
      referenceIds: ["source-4", "source-5"],
      keyPoints: ["Gana el prefijo más específico.", "La ruta por defecto cubre lo desconocido.", "El diagnóstico avanza desde enlace hasta aplicación."],
      narration: "Cuando un router recibe un paquete compara su destino con las entradas de la tabla de enrutamiento. La coincidencia con el prefijo más específico tiene prioridad, porque describe mejor el destino. Si no hay una ruta concreta, puede usar una ruta por defecto. Cuando existen alternativas equivalentes, una métrica expresa cuál se prefiere. Para diagnosticar el recorrido conviene mantener el mismo orden lógico: comprobar enlace, dirección y prefijo, puerta de enlace, resolución de nombres y finalmente el servicio. Ping aporta una señal de alcance, mientras traceroute ayuda a observar saltos intermedios. Ninguna herramienta cuenta toda la historia, pero juntas permiten formular hipótesis y evitar cambios al azar.",
    },
  ],
  questions: [
    { id: "question-0", chapterId: "chapter-1", prompt: "¿Qué decisión toma cada router durante el viaje de un paquete?", options: ["Elige el siguiente salto usando la dirección de destino y su tabla de rutas.", "Decide de una vez todo el recorrido por Internet.", "Convierte siempre el paquete en una conexión TCP."], expectedOption: 0, explanation: "Cada router necesita decidir el siguiente salto; los routers posteriores continúan el proceso hasta llegar a la red de destino." },
    { id: "question-1", chapterId: "chapter-2", prompt: "¿Por qué se separa la comunicación en capas?", options: ["Para simplificar el diseño y permitir que cada parte evolucione de forma independiente.", "Para que los datos viajen siempre por el mismo camino.", "Para eliminar la necesidad de direcciones.", "Para reducir el número de dispositivos."], expectedOption: 0, explanation: "Las capas aíslan responsabilidades, definen interfaces y permiten cambiar una tecnología sin rediseñar todo el sistema." },
    { id: "question-2", chapterId: "chapter-3", prompt: "¿Qué decide un equipo cuando compara el destino con su prefijo?", options: ["Si el destino es local o debe usar la puerta de enlace.", "Qué aplicación abrió el archivo.", "Cuántos routers existen en Internet."], expectedOption: 0, explanation: "El prefijo permite distinguir destinos del mismo segmento de aquellos que requieren enrutamiento." },
    { id: "question-3", chapterId: "chapter-4", prompt: "¿Qué ruta se elige primero si varias coinciden?", options: ["La del prefijo más específico.", "La que se creó primero.", "La que contiene menos números."], expectedOption: 0, explanation: "La coincidencia más larga o específica describe con mayor precisión la red de destino." },
  ],
  closing: "Ya puedes narrar el recorrido de un paquete desde una aplicación hasta otra red, explicar qué responsabilidad asume cada capa y ordenar un diagnóstico básico sin cambiar elementos al azar.",
  recommendedReview: ["Dibuja la encapsulación de una petición web.", "Decide si tres destinos son locales para una red /24.", "Lee una tabla de rutas pequeña y justifica la ruta elegida."],
};

const DEMO_BLOCKS: Array<Array<{ kind: TeachingBlockKind; title: string; sentenceCount: number }>> = [
  [
    { kind: "scenario", title: "Un paquete sale de tu portátil", sentenceCount: 3 },
    { kind: "explanation", title: "Decisiones salto a salto", sentenceCount: 5 },
  ],
  [
    { kind: "explanation", title: "Responsabilidades separadas", sentenceCount: 5 },
    { kind: "procedure", title: "Encapsular al bajar por la pila", sentenceCount: 2 },
    { kind: "example", title: "Diagnosticar sin sustituir el cable", sentenceCount: 3 },
  ],
  [
    { kind: "explanation", title: "El prefijo decide el alcance", sentenceCount: 5 },
    { kind: "pitfall", title: "Una máscara incorrecta también aísla", sentenceCount: 3 },
  ],
  [
    { kind: "procedure", title: "Seleccionar y comprobar una ruta", sentenceCount: 5 },
    { kind: "comparison", title: "Ping y traceroute responden preguntas distintas", sentenceCount: 4 },
  ],
];

function semanticDemoPlan(): TeachingPlan {
  const migrated = migrateTeachingPlan(LEGACY_NETWORKING_TEACHING_PLAN);
  return teachingPlanSchema.parse({
    ...migrated,
    chapters: migrated.chapters.map((chapter, chapterIndex) => {
      const sentences = chapter.blocks[0].content.match(/[^.!?]+[.!?]+(?:[”»"])?/g)?.map((sentence) => sentence.trim()) ?? [chapter.blocks[0].content];
      let cursor = 0;
      const specs = DEMO_BLOCKS[chapterIndex];
      return {
        ...chapter,
        blocks: specs.map((spec, blockIndex) => {
          const isLast = blockIndex === specs.length - 1;
          const content = sentences.slice(cursor, isLast ? undefined : cursor + spec.sentenceCount).join(" ");
          cursor += spec.sentenceCount;
          return { id: `chapter-${chapterIndex + 1}-block-${blockIndex + 1}`, kind: spec.kind, title: spec.title, content, referenceIds: chapter.blocks[0].referenceIds, artifacts: [] };
        }),
      };
    }),
  });
}

export const NETWORKING_TEACHING_PLAN: TeachingPlan = semanticDemoPlan();

export const NETWORKING_TEACHING_PLAN_EN: TeachingPlan = teachingPlanSchema.parse({
  title: "Networking fundamentals: from packet to route",
  summary: "A guided explanation of how layers, addresses, switching, and routing cooperate to move information between networks.",
  objectives: [
    "Explain why network communication is divided into layers.",
    "Distinguish local switching from routing between networks.",
    "Trace a packet and diagnose basic connectivity failures methodically.",
  ],
  requiredConcepts: ["packet", "encapsulation", "TCP/IP", "subnet", "gateway", "routing table"],
  references: [
    { id: "source-1", label: "Packets and communication", excerpt: "Information is split into packets that carry control data and part of the original content.", startLine: 3, endLine: 3 },
    { id: "source-2", label: "Layers and encapsulation", excerpt: "Defined interfaces let one technology change without redesigning the entire communication system.", startLine: 7, endLine: 11 },
    { id: "source-3", label: "Addresses and subnets", excerpt: "The prefix determines which destinations are local and which require a gateway.", startLine: 15, endLine: 19 },
    { id: "source-4", label: "Switching and routing", excerpt: "A router consults its routing table and chooses the most specific matching prefix.", startLine: 23, endLine: 25 },
    { id: "source-5", label: "Reasoned troubleshooting", excerpt: "Troubleshooting by layer avoids random changes and narrows the fault.", startLine: 29, endLine: 31 },
  ],
  chapters: [
    {
      id: "chapter-1", title: "How a packet travels", purpose: "Build a mental model of how information crosses local and routed networks.", estimatedMinutes: 4,
      keyPoints: ["Information is divided into packets.", "Each hop decides only the next step.", "Control data makes delivery possible."],
      blocks: [
        { id: "chapter-1-block-1", kind: "scenario", title: "A packet leaves your laptop", content: "Imagine requesting a web page from your laptop. The information is divided into packets, and each packet receives control data that identifies its origin, destination, and handling requirements.", referenceIds: ["source-1"], artifacts: [] },
        { id: "chapter-1-block-2", kind: "explanation", title: "Decisions from hop to hop", content: "A switch moves the local frame toward the gateway. The router examines the destination IP address and chooses the best next hop. Other routers repeat that bounded decision until the packet reaches the destination network.", referenceIds: ["source-4"], artifacts: [] },
      ],
    },
    {
      id: "chapter-2", title: "Layers organize communication", purpose: "Understand how layers reduce complexity and separate responsibilities.", estimatedMinutes: 5,
      keyPoints: ["TCP/IP separates clear responsibilities.", "Each layer uses the services below it.", "Separation supports evolution and diagnosis."],
      blocks: [
        { id: "chapter-2-block-1", kind: "explanation", title: "Separated responsibilities", content: "The application, transport, Internet, and access layers each solve a different part of communication. Their interfaces allow protocols and physical media to evolve without changing the meaning of the application data.", referenceIds: ["source-2"], artifacts: [] },
        { id: "chapter-2-block-2", kind: "procedure", title: "Encapsulating down the stack", content: "As data moves down the stack, each layer adds the control information it needs. The destination removes that information in reverse order before delivering the original content to the application.", referenceIds: ["source-2"], artifacts: [] },
        { id: "chapter-2-block-3", kind: "example", title: "Diagnosing without replacing the cable", content: "If an IP address is reachable but a host name is not, basic connectivity is already working. That evidence points toward name resolution rather than the cable or radio link.", referenceIds: ["source-2", "source-5"], artifacts: [] },
      ],
    },
    {
      id: "chapter-3", title: "Addresses and subnets", purpose: "Relate prefixes, local destinations, and the default gateway.", estimatedMinutes: 4,
      keyPoints: ["IPv4 uses 32 bits.", "The prefix separates network and host portions.", "External destinations use the gateway."],
      blocks: [
        { id: "chapter-3-block-1", kind: "explanation", title: "The prefix decides the scope", content: "A device applies its prefix to both its own address and the destination. A matching network can be reached locally; a different network requires the configured gateway.", referenceIds: ["source-3"], artifacts: [] },
        { id: "chapter-3-block-2", kind: "pitfall", title: "A wrong prefix can isolate a device", content: "A valid-looking address with an inconsistent prefix changes the delivery decision. Two devices can share a physical link and still fail to communicate because they disagree about what is local.", referenceIds: ["source-3"], artifacts: [] },
      ],
    },
    {
      id: "chapter-4", title: "Choosing and checking a route", purpose: "Interpret route selection and apply a layered troubleshooting sequence.", estimatedMinutes: 4,
      keyPoints: ["The most specific prefix wins.", "A default route covers unknown destinations.", "Diagnosis moves from link to application."],
      blocks: [
        { id: "chapter-4-block-1", kind: "procedure", title: "Select and verify a route", content: "A router compares the destination with its routing entries and selects the most specific match. When no specific route exists, it may use the default route. Diagnosis should then check link, addressing, gateway, DNS, and the application in order.", referenceIds: ["source-4", "source-5"], artifacts: [] },
        { id: "chapter-4-block-2", kind: "comparison", title: "Ping and traceroute answer different questions", content: "Ping provides a basic reachability signal, while traceroute exposes intermediate hops. Neither tells the complete story, but together they provide evidence for narrower and safer hypotheses.", referenceIds: ["source-4", "source-5"], artifacts: [] },
      ],
    },
  ],
  questions: [
    { id: "question-0", chapterId: "chapter-1", prompt: "What does each router decide while a packet travels?", options: ["The next hop, using the destination and its routing table.", "The entire path across the Internet in advance.", "Whether every packet must become a TCP connection."], expectedOption: 0, explanation: "Each router makes a bounded next-hop decision; later routers continue the process." },
    { id: "question-1", chapterId: "chapter-2", prompt: "Why is communication separated into layers?", options: ["To isolate responsibilities and let components evolve independently.", "To force all data along the same path.", "To remove the need for addresses."], expectedOption: 0, explanation: "Layers define interfaces and isolate responsibilities, reducing the effect of change." },
    { id: "question-2", chapterId: "chapter-3", prompt: "What does a device determine by comparing the destination with its prefix?", options: ["Whether the destination is local or requires the gateway.", "Which application opened a file.", "How many routers exist on the Internet."], expectedOption: 0, explanation: "The prefix distinguishes local destinations from destinations that require routing." },
    { id: "question-3", chapterId: "chapter-4", prompt: "Which route is preferred when several entries match?", options: ["The route with the most specific prefix.", "The route created first.", "The route containing the fewest numbers."], expectedOption: 0, explanation: "The longest matching prefix describes the destination network most precisely." },
  ],
  closing: "You can now describe a packet's journey, explain the responsibility of each layer, and organize a basic network diagnosis without making random changes.",
  recommendedReview: ["Draw the encapsulation of a web request.", "Classify three destinations as local or routed for a /24 network.", "Read a small routing table and justify the selected route."],
});

export class DemoTeachingPlanProvider implements TeachingPlanProvider {
  async createPlan(input: CreateLessonInput): Promise<TeachingPlan> {
    const base = input.contentLanguage === "es-ES" ? NETWORKING_TEACHING_PLAN : NETWORKING_TEACHING_PLAN_EN;
    const personalized = { ...base, summary: `${base.summary} ${input.contentLanguage === "es-ES" ? "Objetivo" : "Objective"}: ${input.objective}` };
    return teachingPlanSchema.parse(personalized);
  }
}

export class DemoSpeechProvider implements SpeechProvider {
  readonly profileKey = "demo:browser-speech:v2";
  readonly profile = { provider: "demo", nodeId: null, voice: "browser-default", speed: 1, language: "es", style: "neutral", pronunciation: "literal" } as const;
  async synthesize() {
    return { kind: "browser-speech" as const, mimeType: "application/x-browser-speech" as const };
  }
}
