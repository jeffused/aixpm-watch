---
title: "Le playbook de cadrage des missions IA qui tiennent leur budget"
date: 2026-05-15
categories:
  - AI-opportunites
  - best-practice
tags:
  - praticien
  - gate-review
  - comite-pilotage
  - roi-chiffre
authors:
  - jeff
sources:
  - url: https://www.reddit.com/r/consulting/comments/1tdttfc/has_anyone_here_seen_an_ai_engagement_come_in/
    name: Reddit r/consulting
    type: reddit
    fetched: 2026-05-20
    fetch-status: ok
status: draft
revision-count: 0
---

# Le playbook de cadrage des missions IA qui tiennent leur budget

RAND chiffre à 80 % les projets IA d'entreprise qui ne sont jamais déployés, Gartner annonce 60 % d'annulations sur les projets agentiques d'ici fin 2026, et le poste « data plumbing » pèse 20 à 40 % du coût d'une première mission IA. Sur un fil r/consulting de 39 commentaires, un praticien décrit la seule mission qu'il a vue atterrir à 94 % du budget — un éditeur SaaS B2B mid-market — et le décompose en trois gestes de cadrage reproductibles.

Premier geste : un audit data **avant** le chiffrage, pas après la signature ni pendant le PoC. Deux semaines de découverte non facturées sur le schéma de l'entrepôt et la santé des pipelines. Verdict : le scope demandé par les sponsors était infaisable sur l'infrastructure existante. La mission est repérimétrée autour de ce qui est réellement atteignable, et seulement à ce moment-là chiffrée. Deuxième geste : les jalons sont indexés sur des **états de la donnée**, pas sur des dates. Au lieu de « modèle déployé semaine 8 », le gate est « modèle déployé une fois que le pipeline d'ingestion passe ces trois contrôles qualité ». Le risque de données sales sort du planning du prestataire et devient une condition factuelle que le client doit lever.

Le commentaire ajoute une lecture qui mérite d'arriver en comité de pilotage : « Le dépassement n'est presque jamais un problème technique déguisé, c'est un problème de cadrage. » Le coût de remise en état de la donnée est connu, mais il rend la proposition commerciale moins attractive — donc il finit enterré dans les hypothèses. D'autres commentateurs prolongent la même idée : le PoC qui tient son budget repose sur des lignes nettoyées à la main que personne ne re-chiffre côté production, et les missions « sous budget » se limitent en pratique aux chatbots étroits ou aux agents sans tête bien délimités. Pour un PMO qui prépare un gate review IA, le triptyque audit-rescope-quality-gate est un instrument défendable face à un sponsor qui veut « un POC en six semaines ».

[Source : Reddit r/consulting, 15 mai 2026 →](https://www.reddit.com/r/consulting/comments/1tdttfc/has_anyone_here_seen_an_ai_engagement_come_in/)
