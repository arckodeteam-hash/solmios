<!-- fragmento compartido: bloque de auditoría paralela -->
## Auditar en paralelo

Lanzá **cuatro** `lk-qa` en un solo mensaje, con cuatro llamadas a la vez, para que
corran concurrentes. A cada uno pasale su carril:

| Carril | Dimensiones | Qué mira |
|---|---|---|
| `estructura` | D1 D2 D3 D12 | ubicación de archivos, patrones del repo, consistencia con el vecino, contratos |
| `correccion` | D4 D5 | clean code medible, edge cases, caminos de error |
| `seguridad` | D6 D9 | authn/authz, validación, aislamiento, secretos, config |
| `medidas` | D7 D8 D10 D11 | tests, gates, alcance del diff, deuda introducida |

Instrucción para cada uno, cambiando `<carril>`:

> Auditá el diff actual, carril `<carril>`. Corré todos tus comandos con
> `LOOPKIT_LANE=<carril>` antepuesto. Empezá por `LOOPKIT_LANE=<carril> bash .loopkit/core/lk card new`.
> No adelantes conclusiones favorables. No puntúes lo que no inspeccionaste.

No les cuentes tus conclusiones ni les digas que el código está bien: tienen que llegar
solos. Si les adelantás el resultado, la auditoría no vale nada.

Cuando vuelven los cuatro:

```bash
bash .loopkit/core/lk card merge lk-qa
bash .loopkit/core/lk card show
```

El merge se queda con el score **más bajo** de cada dimensión y con la severidad **más
alta** de cada hallazgo repetido. Si un carril auditó sobre un diff viejo, el merge falla
y hay que re-auditar: significa que el código cambió durante la auditoría.
