---
title: "Anonymiser la donnée client : trois techniques de praticiens"
date: 2026-05-05
categories:
  - AI-prerequis
  - technique
tags:
  - enabler-confidentialite
  - enabler-data-classification
  - enabler-local-llm
  - praticien
authors:
  - jeff
sources:
  - url: https://www.reddit.com/r/consulting/comments/1t4pcxb/how_do_you_anonymize_company_data_to_be_used_in_ai/
    name: Reddit r/consulting
    type: reddit
    fetched: 2026-05-19
    fetch-status: ok
status: draft
revision-count: 0
---

# Anonymiser la donnée client : trois techniques de praticiens

Sur r/consulting, un consultant en environnement Microsoft 365 demande comment éviter le va-et-vient manuel — remplacer noms et chiffres à la main avant chaque session ChatGPT — pour des fichiers Excel et des documents commerciaux. Quarante-neuf commentaires plus tard, le fil converge sur trois techniques distinctes, classées par niveau d'investissement, plus une correction utile sur les politiques internes.

Premier niveau, la licence : payer une offre entreprise qui garantit l'absence d'entraînement sur les données saisies (Copilot, Claude Enterprise, ChatGPT Enterprise). Réponse la plus votée du fil, et la plus rapide quand la direction achète. Deuxième niveau, l'outil ouvert : Microsoft Presidio, open source, tourne en local en Python, détecte noms, adresses, dates et tout motif ajouté par regex (codes client, montants). Installation en une demi-heure. Le détail qui fait la différence : l'envelopper d'un dictionnaire de correspondances stable — « Acme Corp » devient toujours « ORG_1 » à travers tous les fichiers — sinon le modèle perd le fil de qui fait quoi. Troisième niveau, le bricolage Excel : multiplier chaque colonne numérique par une constante aléatoire avant collage. Les ratios et tendances survivent, les valeurs absolues non, et l'analyse « Q3 a progressé de 18 % » reste exploitable.

Un commentateur corrige un raccourci fréquent : les API payantes d'Anthropic et OpenAI n'entraînent pas leurs modèles sur les entrées par défaut. Beaucoup de politiques internes « pas d'IA » s'appuient sur une lecture obsolète du grand public et bloquent un usage qui, au niveau API, ne pose pas le risque qu'elles croient adresser.

[Source : Reddit r/consulting, 5 mai 2026 →](https://www.reddit.com/r/consulting/comments/1t4pcxb/how_do_you_anonymize_company_data_to_be_used_in_ai/)
