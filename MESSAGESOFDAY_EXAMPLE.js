/**
 * Beispiel Konfiguration für das MessagesOfDay Widget
 *
 * Füge dies in deine config/config.js ein:
 */
{
    module: "MMM-Webuntis",
        position: "top_right",
            header: "WebUntis",
                config: {
        logLevel: "info",
            fetchIntervalMs: 15 * 60 * 1000, // 15 Minuten
                daysToShow: 7,

                    // Aktiviere das MessagesOfDay Widget
                    displayMode: "messagesofday,lessons,exams,homework,absences",

                        students: [
                            {
                                title: "Mein Kind",
                                qrcode: "untis://setschool?...",  // Ersetze dies mit deinem QR-Code
                                // oder verwende username/password:
                                // school: "schoolname",
                                // username: "student.username",
                                // password: "password",
                                // server: "mese.webuntis.com"
                            }
                        ]
    }
}

/**
 * Alternativ: Zeige nur MessagesOfDay:
 */
{
    module: "MMM-Webuntis",
        position: "top_right",
            header: "Nachrichten des Tages",
                config: {
        displayMode: "messagesofday",  // Nur MessagesOfDay anzeigen
            students: [
                {
                    title: "Schule",
                    qrcode: "untis://setschool?..."
                }
            ]
    }
}
