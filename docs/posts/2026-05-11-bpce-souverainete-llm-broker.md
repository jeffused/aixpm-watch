---
title: "BPCE : la souveraineté GenAI comme architecture, pas comme posture"
date: 2026-05-11
categories:
  - AI-prerequis
  - architecture
tags:
  - enabler-confidentialite
  - enabler-ai-policy
  - enabler-data-classification
  - corporate
  - france
authors:
  - jeff
sources:
  - url: https://www.cio-online.com/actualites/lire-interview-bpce--pour-la-genai-nous-avons-fait-un-choix-de-souverainete-pour-etre-en-capacite-de-maitriser-notre-destin-17020.html
    name: CIO-online
    type: press
    fetched: 2026-05-20
    fetch-status: ok
    reporter: Emmanuelle Delsol
status: draft
revision-count: 0
---

# BPCE : la souveraineté GenAI comme architecture, pas comme posture

Le groupe BPCE traite la souveraineté GenAI comme une couche d'infrastructure, pas comme une déclaration de principe. Luc Barnaud, chief AI and data officer, et Laurent Fernandez, directeur du centre d'expertise technologique, ont détaillé dans CIO-online un broker de LLM interne qui route dynamiquement les requêtes vers OpenAI, Google, Anthropic, Mistral, ou des modèles instanciés on premise — depuis des tenants Azure ou GCP validés au préalable par les équipes cyber.

L'aiguillage suit une cascade explicite : compatibilité d'abord avec les tenants cloud sécurisés, sinon redirection vers les datacenters internes ; puis arbitrage entre performance, latence et coût, en privilégiant les petits modèles quand la tâche le permet. Les données structurées vivent dans un datalake mutualisé sur BigQuery (GCP chiffré) ; les données sensibles restent on premise. « Nous n'utiliserons aucun service qui ne tourne pas dans une zone RGPD », précise Barnaud. GitHub Copilot a été rejeté par la sécurité ; BPCE a déployé son plug-in maison Continue, sur base open source, auprès de 2 000 développeurs.

Le signal pour les DSI et architectes en secteur régulé est net : la souveraineté n'est pas un slogan défensif, c'est une couche d'abstraction agnostique. « Il est essentiel pour nous, en matière de souveraineté mais aussi de coûts, de maîtriser notre gare de triage vers des partenaires que nous avons choisis », résume Barnaud. La même couche sert le FinOps (suivi quotidien des coûts par LLM), la mutualisation (point d'accès unique pour tous les produits GenAI internes) et l'agilité — changer de modèle se réduit à une virgule dans un appel API.

[Source : CIO-online, 11 mai 2026, Emmanuelle Delsol →](https://www.cio-online.com/actualites/lire-interview-bpce--pour-la-genai-nous-avons-fait-un-choix-de-souverainete-pour-etre-en-capacite-de-maitriser-notre-destin-17020.html)
