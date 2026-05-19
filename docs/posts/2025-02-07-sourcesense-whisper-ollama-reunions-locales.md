---
title: "Une chaîne de transcription 100 % locale pour les réunions confidentielles"
date: 2025-02-07
categories:
  - AI-prerequis
  - architecture
tags:
  - enabler-confidentialite
  - enabler-local-llm
  - praticien
  - meetings
authors:
  - jeff
sources:
  - url: https://medium.com/sourcesense-techblog/ai-powered-transcripts-and-summaries-with-llms-d475b742e854
    name: Sourcesense TechBlog (Medium)
    type: blog
    fetched: 2026-05-19
    fetch-status: ok
    reporter: Mirko Panagrosso
status: draft
revision-count: 0
---

# Une chaîne de transcription 100 % locale pour les réunions confidentielles

Confronté à des centaines d'heures d'enregistrements de réunions à documenter sous contrainte de confidentialité, Mirko Panagrosso (Sourcesense) décrit une chaîne de traitement entièrement locale, exécutable sur « un ordinateur portable de gamme moyenne (la machine de développeur typique fournie par l'entreprise) ». Le cloud est exclu d'emblée : il s'agit de garantir que « les données restent intégralement sous le contrôle de l'entreprise ».

La chaîne s'articule en trois étages. Whisper (modèle `medium.en` d'OpenAI) assure la transcription audio par fragments de trente secondes. Ollama, exécutant Gemma2 (préféré à Llama 3.1/3.2), nettoie ensuite la transcription brute par tronçons de 40 à 50 lignes, en zero-shot et à température 0,1 pour éviter toute créativité parasite. Le même couple Ollama + Gemma2 produit enfin le compte rendu, en chain-of-thought zero-shot, avec listes à puces en markdown et glossaire métier. Un script Node.js orchestre les appels HTTP à `localhost:11434`.

Sur une dizaine d'heures d'audio testées, l'auteur juge le résultat solide — « particulièrement bon dans les contextes où les voix ne se chevauchent pas trop » — tout en prévenant qu'« un travail manuel reste nécessaire entre la phase de transcription et celle de retraitement du texte. Et le texte généré doit toujours être évalué. » Le signal intéresse moins pour la pile choisie que pour la démonstration : en 2026, la stack locale est assez mature pour absorber un cas d'usage standard de PMO — comptes rendus de réunions confidentielles — sans qu'un octet ne quitte le poste.

[Source : Sourcesense TechBlog, 07 février 2025, Mirko Panagrosso →](https://medium.com/sourcesense-techblog/ai-powered-transcripts-and-summaries-with-llms-d475b742e854)

## Editor notes

<!-- Add notes here for substantive rewrites. Direct edits to the body above are also fine. -->
