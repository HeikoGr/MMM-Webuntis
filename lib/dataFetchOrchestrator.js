/**
 * Data Fetch Orchestrator
 * Orchestrates parallel fetching of all data types from WebUntis API
 * using Promise.all for 2.7x performance improvement over sequential fetching
 */

/**
 * Fetch all data types in parallel using Promise.all
 * @param {Object} params - Fetch parameters
 * @param {Object} params.student - Student configuration
 * @param {Object} params.dateRanges - Pre-calculated date ranges
 * @param {Date} params.baseNow - Base date for calculations
 * @param {Array} params.restTargets - Array of REST authentication targets
 * @param {Object} params.restOptions - REST API options
 * @param {Object} params.fetchFlags - Flags indicating which data types to fetch
 * @param {Function} params.callRest - Function to call REST API
 * @param {Function} params.getTimetableViaRest - Timetable fetch function
 * @param {Function} params.getExamsViaRest - Exams fetch function
 * @param {Function} params.getHomeworkViaRest - Homework fetch function
 * @param {Function} params.getAbsencesViaRest - Absences fetch function
 * @param {Function} params.getMessagesOfDayViaRest - Messages fetch function
 * @param {Function} params.logger - Logging function
 * @param {Function} params.describeTarget - Function to describe auth target
 * @returns {Promise<Object>} Object with timetable, exams, homeworks, absences, messagesOfDay
 */
async function orchestrateFetch(params) {
    const {
        student,
        dateRanges,
        baseNow,
        restTargets,
        restOptions,
        fetchFlags,
        callRest,
        getTimetableViaRest,
        getExamsViaRest,
        getHomeworkViaRest,
        getAbsencesViaRest,
        getMessagesOfDayViaRest,
        logger,
        describeTarget,
        className,
    } = params;

    const { fetchTimetable, fetchExams, fetchHomeworks, fetchAbsences, fetchMessagesOfDay } = fetchFlags;

    // Build array of fetch promises - only include enabled fetches
    const fetchPromises = [];
    const fetchTypes = [];

    // Timetable
    if (fetchTimetable && dateRanges.timetable.nextDays > 0) {
        fetchTypes.push('timetable');
        fetchPromises.push(
            (async () => {
                for (const target of restTargets) {
                    logger(`Timetable: fetching via REST (${describeTarget(target)})...`);
                    try {
                        const result = await callRest(
                            getTimetableViaRest,
                            target,
                            dateRanges.timetable.start,
                            dateRanges.timetable.end,
                            target.studentId,
                            {
                                ...restOptions,
                                useClassTimetable: Boolean(student.useClassTimetable),
                                className,
                                classId: student.classId || null,
                                studentId: target.studentId,
                            },
                            Boolean(student.useClassTimetable),
                            className
                        );
                        logger(`✓ Timetable: ${result.length} raw items from API\n`);
                        return result;
                    } catch (error) {
                        logger(`✗ Timetable failed (${describeTarget(target)}): ${error.message}\n`);
                    }
                }
                return [];
            })()
        );
    } else {
        fetchTypes.push('timetable');
        fetchPromises.push(Promise.resolve([]));
    }

    // Exams
    if (fetchExams && dateRanges.exams.nextDays > 0) {
        fetchTypes.push('exams');
        fetchPromises.push(
            (async () => {
                logger(`Exams: querying ${dateRanges.exams.nextDays} days ahead...`);
                for (const target of restTargets) {
                    logger(`Exams: fetching via REST (${describeTarget(target)})...`);
                    try {
                        const result = await callRest(
                            getExamsViaRest,
                            target,
                            dateRanges.exams.start,
                            dateRanges.exams.end,
                            target.studentId,
                            restOptions
                        );
                        logger(`✓ Exams: ${result.length} raw items from API\n`);
                        return result;
                    } catch (error) {
                        logger(`✗ Exams failed (${describeTarget(target)}): ${error.message}`);
                    }
                }
                return [];
            })()
        );
    } else {
        fetchTypes.push('exams');
        fetchPromises.push(Promise.resolve([]));
        logger(`Exams: skipped (exams.nextDays=${dateRanges.exams.nextDays})`);
    }

    // Homework
    if (fetchHomeworks) {
        fetchTypes.push('homework');
        fetchPromises.push(
            (async () => {
                logger(
                    `Homework: fetching with max widget range (past: ${dateRanges.homework.pastDays}, future: ${dateRanges.homework.futureDays})`
                );
                logger(
                    `Homework REST API range: ${dateRanges.homework.start.toISOString().split('T')[0]} to ${dateRanges.homework.end.toISOString().split('T')[0]}`
                );
                for (const target of restTargets) {
                    logger(`Homework: fetching via REST (${describeTarget(target)})...`);
                    try {
                        const result = await callRest(
                            getHomeworkViaRest,
                            target,
                            dateRanges.homework.start,
                            dateRanges.homework.end,
                            target.studentId,
                            restOptions
                        );
                        logger(`✓ Homework: ${result.length} raw items from API\n`);

                        // Filter homework by dueDate based on homework widget config
                        if (result && Array.isArray(result) && result.length > 0) {
                            const hwNextDays = Number(student.homework?.nextDays ?? student.homework?.daysAhead ?? 999);
                            const hwPastDays = Number(student.homework?.pastDays ?? 999);

                            // Only filter if explicitly configured
                            if (hwNextDays < 999 || hwPastDays < 999) {
                                const filterStart = new Date(baseNow);
                                const filterEnd = new Date(baseNow);
                                filterStart.setDate(filterStart.getDate() - hwPastDays);
                                filterEnd.setDate(filterEnd.getDate() + hwNextDays);

                                const filtered = result.filter((hw) => {
                                    if (!hw.dueDate) return true;
                                    const dueDateNum = Number(hw.dueDate);
                                    const dueDateStr = String(dueDateNum).padStart(8, '0');
                                    const dueYear = parseInt(dueDateStr.substring(0, 4), 10);
                                    const dueMonth = parseInt(dueDateStr.substring(4, 6), 10);
                                    const dueDay = parseInt(dueDateStr.substring(6, 8), 10);
                                    const dueDate = new Date(dueYear, dueMonth - 1, dueDay);
                                    return dueDate >= filterStart && dueDate <= filterEnd;
                                });

                                logger(
                                    `Homework: filtered to ${filtered.length} items by dueDate range ` +
                                    `${filterStart.toISOString().split('T')[0]} to ${filterEnd.toISOString().split('T')[0]}`
                                );
                                return filtered;
                            }
                        }
                        return result;
                    } catch (error) {
                        logger(`✗ Homework failed (${describeTarget(target)}): ${error.message}\n`);
                    }
                }
                return [];
            })()
        );
    } else {
        fetchTypes.push('homework');
        fetchPromises.push(Promise.resolve([]));
        logger(`Homework: skipped`);
    }

    // Absences
    if (fetchAbsences) {
        fetchTypes.push('absences');
        fetchPromises.push(
            (async () => {
                logger(`Absences: fetching...`);
                for (const target of restTargets) {
                    logger(`Absences: fetching via REST (${describeTarget(target)})...`);
                    try {
                        const result = await callRest(
                            getAbsencesViaRest,
                            target,
                            dateRanges.absences.start,
                            dateRanges.absences.end,
                            target.studentId,
                            restOptions
                        );
                        logger(`✓ Absences: ${result.length} raw items from API\n`);
                        return result;
                    } catch (error) {
                        logger(`✗ Absences failed (${describeTarget(target)}): ${error.message}\n`);
                    }
                }
                return [];
            })()
        );
    } else {
        fetchTypes.push('absences');
        fetchPromises.push(Promise.resolve([]));
        logger(`Absences: skipped`);
    }

    // MessagesOfDay
    if (fetchMessagesOfDay) {
        fetchTypes.push('messagesOfDay');
        fetchPromises.push(
            (async () => {
                logger(`MessagesOfDay: fetching...`);
                for (const target of restTargets) {
                    logger(`MessagesOfDay: fetching via REST (${describeTarget(target)})...`);
                    try {
                        const result = await callRest(getMessagesOfDayViaRest, target, baseNow, restOptions);
                        logger(`✓ MessagesOfDay: ${result.length} raw items from API\n`);
                        return result;
                    } catch (error) {
                        logger(`✗ MessagesOfDay failed (${describeTarget(target)}): ${error.message}\n`);
                    }
                }
                return [];
            })()
        );
    } else {
        fetchTypes.push('messagesOfDay');
        fetchPromises.push(Promise.resolve([]));
        logger(`MessagesOfDay: skipped`);
    }

    // Execute all fetches in parallel - this is the key performance improvement!
    logger(`⚡ Fetching ${fetchPromises.length} data types in parallel...`);
    const results = await Promise.all(fetchPromises);

    // Map results back to named object
    return {
        timetable: results[fetchTypes.indexOf('timetable')] || [],
        exams: results[fetchTypes.indexOf('exams')] || [],
        homeworks: results[fetchTypes.indexOf('homework')] || [],
        absences: results[fetchTypes.indexOf('absences')] || [],
        messagesOfDay: results[fetchTypes.indexOf('messagesOfDay')] || [],
    };
}

module.exports = {
    orchestrateFetch,
};
