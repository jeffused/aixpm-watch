---
title: "Mistral 7B en local sur un MacBook : la sortie de secours d'un chef de projet face a la politique IA de son entreprise"
date: 2026-03-23
categories:
  - AI-prerequis
  - architecture
tags:
  - enabler-confidentialite
  - enabler-local-llm
  - praticien
  - reporting
  - meetings
  - project-management
authors:
  - jeff
sources:
  - url: https://www.reddit.com/r/LocalLLaMA/comments/1s0en62/running_mistral_locally_for_meeting_notes_and_its/
    name: Reddit r/LocalLLaMA
    type: reddit
    fetched: 2026-05-18
    fetch-status: ok
status: draft
revision-count: 0
---

# Mistral 7B en local sur un MacBook : la sortie de secours d'un chef de projet face a la politique IA de son entreprise

Quatre a six reunions par jour, des notes a transformer en tickets Jira et en synthese Confluence, mais une politique interne qui interdit d'envoyer du contenu de reunion vers un outil tiers : ce chef de projet poste sur r/LocalLLaMA explique comment il a contourne le mur. Pas en demandant une derogation, pas en attendant le feu vert infosec — en installant Mistral 7B sur son MacBook via Ollama.

Le workflow est volontairement minimaliste. Apres chaque reunion, il colle son texte brut — frappe ou dicte sans ponctuation via Willow Voice — dans le modele local. Un prompt unique : « here are notes from a project meeting. extract action items with owner and deadline. format as a bullet list. ». Dix secondes plus tard, la liste d'actions part dans Jira, la synthese dans Confluence. L'auteur revendique 85% de bonne extraction, attribuant les 15% restants a du contexte absent en entree, pas a un defaut du modele. La latence sur M2 Pro est jugee « assez rapide pour ne pas interrompre le flux de travail ».

L'argument confidentialite est explicite et a deux faces : « running it locally means I'm not sending anything anywhere and I don't need to deal with infosec reviews ». La premiere face est la politique formelle de l'entreprise sur le contenu de reunion. La seconde, plus interessante, est le cout personnel d'un examen infosec a chaque nouvel outil SaaS — un frein silencieux que beaucoup de praticiens absorbent sans le nommer. Mistral 7B sur materiel grand public, c'est moins une prouesse technique qu'une option d'architecture individuelle : un PM peut se rendre productif sur une tache de reporting recurrente sans declencher de processus interne. Le debat « 7B est-il depasse face a Qwen 3.5 4B ? » occupe les commentaires, mais il est secondaire — l'arbitrage du praticien porte sur l'acces, pas sur le benchmark.

[Source : Reddit r/LocalLLaMA, 22 mars 2026 →](https://www.reddit.com/r/LocalLLaMA/comments/1s0en62/running_mistral_locally_for_meeting_notes_and_its/)

## Editor notes

<!-- Add notes here for substantive rewrites. Direct edits to the body above are also fine. -->
