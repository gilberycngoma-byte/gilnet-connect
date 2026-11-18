import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import javax.imageio.ImageIO;

public class GenerateAndroidBranding {
    private static final List<IconDensity> ICON_DENSITIES = List.of(
        new IconDensity("mdpi", 48, 108, 1),
        new IconDensity("hdpi", 72, 162, 1.5),
        new IconDensity("xhdpi", 96, 216, 2),
        new IconDensity("xxhdpi", 144, 324, 3),
        new IconDensity("xxxhdpi", 192, 432, 4)
    );

    public static void main(String[] args) throws IOException {
        Path root = Path.of(System.getProperty("user.dir"));
        Path sourcePath = root.resolve("public/icon-1024.png");
        if (!Files.isRegularFile(sourcePath)) {
            throw new IOException("GILNET source icon was not found: " + sourcePath);
        }

        BufferedImage source = ImageIO.read(sourcePath.toFile());
        if (source == null) {
            throw new IOException("Could not read the GILNET source icon: " + sourcePath);
        }

        Path resources = root.resolve("android/app/src/main/res");
        BufferedImage foreground = removeWhiteBackground(source);
        for (IconDensity density : ICON_DENSITIES) {
            Path folder = resources.resolve("mipmap-" + density.name());
            writeIcon(source, folder.resolve("ic_launcher.png"), density.iconSize(), false);
            writeIcon(source, folder.resolve("ic_launcher_round.png"), density.iconSize(), false);
            writeIcon(foreground, folder.resolve("ic_launcher_foreground.png"), density.foregroundSize(), true);

            writeSplash(source, resources.resolve("drawable-port-" + density.name() + "/splash.png"),
                (int) Math.round(320 * density.scale()), (int) Math.round(480 * density.scale()));
            writeSplash(source, resources.resolve("drawable-land-" + density.name() + "/splash.png"),
                (int) Math.round(480 * density.scale()), (int) Math.round(320 * density.scale()));
        }
        writeSplash(source, resources.resolve("drawable/splash.png"), 480, 320);

        System.out.println("Generated GILNET Android launcher icons and splash screens.");
    }

    private static BufferedImage removeWhiteBackground(BufferedImage source) {
        BufferedImage result = new BufferedImage(source.getWidth(), source.getHeight(), BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < source.getHeight(); y++) {
            for (int x = 0; x < source.getWidth(); x++) {
                int argb = source.getRGB(x, y);
                int red = (argb >>> 16) & 0xff;
                int green = (argb >>> 8) & 0xff;
                int blue = argb & 0xff;
                int alpha = red >= 248 && green >= 248 && blue >= 248 ? 0 : 255;
                result.setRGB(x, y, (alpha << 24) | (argb & 0x00ffffff));
            }
        }
        return result;
    }

    private static void writeIcon(BufferedImage source, Path target, int size, boolean adaptiveForeground)
        throws IOException {
        BufferedImage canvas = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = canvas.createGraphics();
        try {
            if (!adaptiveForeground) {
                graphics.setColor(Color.WHITE);
                graphics.fillRect(0, 0, size, size);
            }
            configureQuality(graphics);
            int drawSize = adaptiveForeground ? (int) Math.round(size * 0.72) : size;
            int offset = (size - drawSize) / 2;
            graphics.drawImage(source, offset, offset, drawSize, drawSize, null);
        } finally {
            graphics.dispose();
        }
        savePng(canvas, target);
    }

    private static void writeSplash(BufferedImage source, Path target, int width, int height) throws IOException {
        BufferedImage canvas = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = canvas.createGraphics();
        try {
            graphics.setColor(Color.WHITE);
            graphics.fillRect(0, 0, width, height);
            configureQuality(graphics);
            int logoSize = (int) Math.round(Math.min(width, height) * 0.7);
            int left = (width - logoSize) / 2;
            int top = (height - logoSize) / 2;
            graphics.drawImage(source, left, top, logoSize, logoSize, null);
        } finally {
            graphics.dispose();
        }
        savePng(canvas, target);
    }

    private static void configureQuality(Graphics2D graphics) {
        graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    }

    private static void savePng(BufferedImage image, Path target) throws IOException {
        Files.createDirectories(target.getParent());
        if (!ImageIO.write(image, "png", target.toFile())) {
            throw new IOException("Could not write PNG asset: " + target);
        }
    }

    private record IconDensity(String name, int iconSize, int foregroundSize, double scale) {}
}
