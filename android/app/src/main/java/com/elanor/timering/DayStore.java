package com.elanor.timering;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

final class DayStore {
    private final Path directory;

    DayStore(Path directory) throws IOException {
        this.directory = directory;
        Files.createDirectories(directory);
    }

    private Path file(String date) {
        if (date == null || !date.matches("\\d{4}-\\d{2}-\\d{2}") || !LocalDate.parse(date).toString().equals(date)) {
            throw new IllegalArgumentException("Invalid date");
        }
        return directory.resolve(date + ".json");
    }

    synchronized String read(String date) throws IOException {
        Path path = file(date);
        return Files.exists(path) ? new String(Files.readAllBytes(path), StandardCharsets.UTF_8) : null;
    }

    synchronized void write(String date, String json) throws IOException {
        Path target = file(date);
        Path temporary = directory.resolve(date + ".tmp");
        Files.write(temporary, json.getBytes(StandardCharsets.UTF_8));
        try {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException ex) {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    synchronized List<String> list() throws IOException {
        try (Stream<Path> paths = Files.list(directory)) {
            return paths.filter(Files::isRegularFile)
                .map(path -> path.getFileName().toString())
                .filter(name -> name.matches("\\d{4}-\\d{2}-\\d{2}\\.json"))
                .map(name -> name.substring(0, 10))
                .sorted(java.util.Comparator.reverseOrder())
                .collect(Collectors.toList());
        }
    }
}
