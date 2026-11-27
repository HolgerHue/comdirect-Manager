# Ablauf: Order senden (as-built, unverified)

1. Zusatzfunktion `order` an → Aktion `order-form` zeigt das Formular.
2. `order-review`: Anmeldung (TAN), Handelsplätze (`orders/dimensions`), Vorabprüfung (`prevalidation`), Kostenindikation (`costindicationexante`).
3. `order-send`: Bestätigungsdialog „verbindlich senden?“ → Validierung (`validation`, TAN) → `POST /brokerage/v3/orders`.
4. `ORDER_PENDING` wird vor dem Senden geleert, damit nie zweimal gesendet wird.
