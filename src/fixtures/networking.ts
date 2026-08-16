export const NETWORKING_FIXTURE = `# Fundamentos de redes: del paquete a la ruta

Una red permite que dispositivos diferentes intercambien información siguiendo reglas comunes. La información no viaja como un bloque único: se divide en paquetes que incluyen datos de control y una porción del contenido. Cada paquete puede atravesar varios enlaces y equipos antes de llegar a su destino.

## Capas y encapsulación

Los modelos por capas reducen la complejidad. En TCP/IP, la capa de aplicación alberga protocolos usados por los programas, como HTTP y DNS. La capa de transporte ofrece comunicación extremo a extremo: TCP añade orden, confirmaciones y control de flujo, mientras UDP reduce sobrecarga cuando la aplicación tolera pérdidas. La capa de Internet usa IP para direccionar paquetes entre redes. La capa de acceso prepara tramas y bits para Ethernet, fibra o radio.

Al bajar por la pila, cada capa añade su propia información de control: este proceso se denomina encapsulación. En el destino sucede el proceso inverso. Las capas colaboran mediante interfaces definidas, por lo que una tecnología puede cambiar sin rediseñar toda la comunicación.

## Direcciones y subredes

IPv4 utiliza direcciones de 32 bits representadas normalmente como cuatro números decimales. Una máscara o prefijo separa la parte de red de la parte de host. Por ejemplo, 192.168.10.0/24 identifica una red cuyo prefijo ocupa 24 bits. Los equipos comparan el destino con su propia red; si está fuera, envían el paquete a una puerta de enlace.

Una subred define un dominio de direccionamiento y ayuda a organizar equipos, limitar difusión y aplicar políticas. El prefijo no es un adorno: determina qué destinos se consideran locales. Una configuración incoherente puede hacer que dos equipos físicamente conectados no logren comunicarse.

## Conmutación y enrutamiento

Un conmutador mueve tramas dentro de una red local usando direcciones MAC aprendidas. Un router conecta redes IP diferentes. Para cada paquete, consulta una tabla de enrutamiento y elige la coincidencia de prefijo más específica. Si varias rutas son posibles, una métrica ayuda a seleccionar la preferida.

La ruta por defecto se usa cuando no existe una entrada más concreta. En una red doméstica suele apuntar al router del proveedor. En Internet, cada salto decide el siguiente paso: no necesita conocer de antemano el recorrido completo. Herramientas como ping comprueban alcance básico y traceroute revela saltos intermedios, aunque filtros y políticas pueden limitar sus respuestas.

## Diagnóstico razonado

Diagnosticar por capas evita cambios al azar. Primero se comprueba enlace físico o radio; después dirección, prefijo y puerta de enlace; luego resolución DNS; finalmente el servicio de aplicación. Separar responsabilidades permite acotar fallos: tener conectividad IP pero no resolver nombres apunta a un problema distinto de no alcanzar la puerta de enlace.
`;

export const NETWORKING_FIXTURE_NAME = "fundamentos-redes.md";

export const NETWORKING_FIXTURE_EN = `# Networking fundamentals: from packet to route

A network lets different devices exchange information by following shared rules. Information does not travel as one indivisible block: it is split into packets that contain control data and part of the original content. Each packet may cross several links and devices before reaching its destination.

## Layers and encapsulation

Layered models reduce complexity. In TCP/IP, the application layer contains protocols used by programs, such as HTTP and DNS. The transport layer provides end-to-end communication. The Internet layer uses IP to address packets between networks, while the access layer prepares frames and bits for Ethernet, fibre, or radio.

As data moves down the stack, each layer adds its own control information. This is encapsulation. The destination reverses the process. Defined interfaces allow one technology to change without redesigning the entire communication system.

## Addresses and subnets

IPv4 uses 32-bit addresses, normally written as four decimal numbers. A prefix separates the network portion from the host portion. Devices compare a destination with their own network; when it is outside that network, they send the packet to a gateway.

A subnet defines an addressing domain and helps organize devices, limit broadcasts, and apply policies. The prefix is not decoration: it determines which destinations are local. An inconsistent configuration can prevent two physically connected devices from communicating.

## Switching and routing

A switch moves frames inside a local network by using learned MAC addresses. A router connects different IP networks. For every packet, it consults a routing table and chooses the most specific matching prefix. A default route is used when no more specific entry exists.

## Reasoned troubleshooting

Troubleshooting by layer avoids random changes. Check the physical or radio link first, then the address, prefix, and gateway, followed by DNS resolution and finally the application service. Separating responsibilities narrows the fault and produces better hypotheses.
`;

export const NETWORKING_FIXTURE_NAME_EN = "networking-fundamentals.md";
