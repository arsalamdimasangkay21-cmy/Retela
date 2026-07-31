<?php
$adminName = 'RETELA Admin';
$today = date('M d, Y');

$stats = [
  ['label' => 'Monthly Sales', 'value' => 'PHP 128.4K', 'growth' => '+12.5%', 'trend' => 'vs. last month', 'icon' => 'chart'],
  ['label' => 'Orders', 'value' => '342', 'growth' => '+8.2%', 'trend' => 'completed orders', 'icon' => 'orders'],
  ['label' => 'Items Sold', 'value' => '684', 'growth' => '+15.7%', 'trend' => 'thrift pieces', 'icon' => 'items'],
  ['label' => 'Low Stock Alerts', 'value' => '7', 'growth' => '-3.1%', 'trend' => 'needs restock', 'icon' => 'alert'],
];

$brandLabels = ['Nike', 'Adidas', 'Levi\'s', 'Champion', 'New Era'];
$brandSales = [42000, 31500, 28600, 21400, 16800];

$summary = [
  ['label' => 'Total Monthly Revenue', 'value' => 'PHP 128,450'],
  ['label' => 'Best Selling Brand', 'value' => 'Nike'],
  ['label' => 'Most Sold Category', 'value' => 'T-Shirts'],
  ['label' => 'Total Customers', 'value' => '186'],
];

$activities = [
  ['title' => 'Recent order completed', 'time' => '12 minutes ago'],
  ['title' => 'Product restocked', 'time' => '38 minutes ago'],
  ['title' => 'New sale added', 'time' => '1 hour ago'],
];
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RETELA SYSTEM Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'ui-sans-serif', 'system-ui'],
            display: ['Poppins', 'Inter', 'ui-sans-serif']
          },
          colors: {
            ink: '#050505',
            forest: '#0f3d2e',
            neon: '#38ff88'
          }
        }
      }
    };
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
  <style>
    body {
      background:
        radial-gradient(circle at 18% 8%, rgba(56, 255, 136, 0.14), transparent 28%),
        radial-gradient(circle at 92% 20%, rgba(15, 61, 46, 0.75), transparent 30%),
        linear-gradient(145deg, #050505 0%, #07110d 48%, #050505 100%);
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
      background-size: 52px 52px;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,0.85), transparent 78%);
    }

    .glass {
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: linear-gradient(145deg, rgba(255,255,255,0.09), rgba(255,255,255,0.035));
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255,255,255,0.08);
      backdrop-filter: blur(24px);
    }

    .fade-up {
      animation: fadeUp 0.55s ease both;
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body class="min-h-screen overflow-x-hidden font-sans text-white">
  <aside class="fixed inset-y-4 left-4 z-30 hidden w-72 flex-col rounded-[28px] border border-white/10 bg-white/[0.055] p-4 shadow-2xl shadow-black/40 backdrop-blur-2xl lg:flex">
    <div class="rounded-[24px] border border-neon/20 bg-black/50 p-5">
      <div class="flex items-center gap-3">
        <div class="grid h-12 w-12 place-items-center rounded-2xl bg-neon text-black shadow-[0_0_28px_rgba(56,255,136,0.32)]">
          <span class="text-lg font-black">R</span>
        </div>
        <div>
          <h1 class="font-display text-lg font-bold">RETELA SYSTEM</h1>
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-neon/80">Admin Console</p>
        </div>
      </div>
    </div>

    <nav class="mt-5 grid gap-1">
      <?php
        $menu = ['Dashboard', 'Inventory', 'Sales', 'Reports', 'Settings'];
        foreach ($menu as $item):
          $active = $item === 'Dashboard';
      ?>
        <a href="#" class="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition <?php echo $active ? 'bg-neon text-black shadow-[0_0_30px_rgba(56,255,136,0.22)]' : 'text-white/62 hover:bg-white/[0.07] hover:text-white'; ?>">
          <span class="h-2 w-2 rounded-full <?php echo $active ? 'bg-black' : 'bg-white/25'; ?>"></span>
          <?php echo htmlspecialchars($item); ?>
        </a>
      <?php endforeach; ?>
    </nav>
  </aside>

  <main class="relative min-h-screen px-4 py-4 lg:ml-80 lg:px-8">
    <header class="sticky top-0 z-20 mb-5">
      <div class="glass flex flex-wrap items-center justify-between gap-3 rounded-[26px] px-4 py-3">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.22em] text-neon/75">Tela to Pera Thrift Shop</p>
          <h2 class="font-display text-xl font-bold">Dashboard</h2>
        </div>

        <div class="hidden min-w-[260px] max-w-md flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-white/60 md:flex">
          <span class="text-neon">⌕</span>
          <span class="text-sm">Search dashboard...</span>
        </div>

        <div class="flex items-center gap-2">
          <button class="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white/70 transition hover:border-neon/40 hover:text-neon"><?php echo htmlspecialchars($today); ?></button>
          <button class="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/75 transition hover:text-neon">●</button>
          <button class="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 transition hover:border-neon/40">
            <span class="grid h-7 w-7 place-items-center rounded-full bg-neon text-xs font-black text-black">A</span>
            <span class="hidden text-sm font-semibold text-white/85 sm:inline"><?php echo htmlspecialchars($adminName); ?></span>
          </button>
        </div>
      </div>
    </header>

    <section class="fade-up mb-5 rounded-[30px] border border-white/10 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
      <p class="text-xs font-bold uppercase tracking-[0.2em] text-neon/75">RETELA SYSTEM</p>
      <h1 class="mt-3 font-display text-4xl font-bold tracking-tight">Dashboard</h1>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-white/58 sm:text-base">Welcome back! Here's your thrift shop overview.</p>
    </section>

    <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <?php foreach ($stats as $index => $stat): ?>
        <article class="glass fade-up group rounded-[26px] p-5 transition duration-300 hover:-translate-y-1 hover:border-neon/30 hover:shadow-[0_24px_70px_rgba(0,0,0,0.34),0_0_34px_rgba(56,255,136,0.08)]" style="animation-delay: <?php echo $index * 70; ?>ms">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xs font-bold uppercase tracking-[0.18em] text-white/45"><?php echo htmlspecialchars($stat['label']); ?></p>
              <strong class="mt-4 block font-display text-3xl font-bold"><?php echo htmlspecialchars($stat['value']); ?></strong>
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <span class="rounded-full border border-neon/20 bg-neon/10 px-2.5 py-1 text-xs font-bold text-neon"><?php echo htmlspecialchars($stat['growth']); ?></span>
                <span class="text-xs text-white/42"><?php echo htmlspecialchars($stat['trend']); ?></span>
              </div>
            </div>
            <span class="grid h-12 w-12 place-items-center rounded-2xl border border-neon/20 bg-neon/10 text-neon shadow-[0_0_30px_rgba(56,255,136,0.12)]">✦</span>
          </div>
        </article>
      <?php endforeach; ?>
    </section>

    <section class="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
      <article class="glass fade-up rounded-[26px] p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="font-display text-xl font-bold">Best Selling Brands This Year</h2>
            <p class="mt-1 text-sm text-white/45">Yearly sales performance by brand.</p>
          </div>
          <span class="rounded-full border border-neon/20 bg-neon/10 px-3 py-1 text-xs font-bold text-neon">Brand analytics</span>
        </div>
        <div class="mt-6 h-[360px]">
          <canvas id="brandChart"></canvas>
        </div>
      </article>

      <aside class="grid gap-5">
        <article class="glass fade-up rounded-[26px] p-5">
          <h2 class="font-display text-xl font-bold">Quick Summary</h2>
          <div class="mt-4 grid gap-3">
            <?php foreach ($summary as $item): ?>
              <div class="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3">
                <span class="text-sm text-white/55"><?php echo htmlspecialchars($item['label']); ?></span>
                <strong class="text-sm text-white"><?php echo htmlspecialchars($item['value']); ?></strong>
              </div>
            <?php endforeach; ?>
          </div>
        </article>

        <article class="glass fade-up rounded-[26px] p-5">
          <h2 class="font-display text-xl font-bold">Recent Activity</h2>
          <div class="mt-4 grid gap-3">
            <?php foreach ($activities as $activity): ?>
              <div class="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3">
                <strong class="block text-sm text-white"><?php echo htmlspecialchars($activity['title']); ?></strong>
                <span class="mt-1 block text-xs text-white/42"><?php echo htmlspecialchars($activity['time']); ?></span>
              </div>
            <?php endforeach; ?>
          </div>
        </article>
      </aside>
    </section>
  </main>

  <script>
    const labels = <?php echo json_encode($brandLabels); ?>;
    const sales = <?php echo json_encode($brandSales); ?>;
    const canvas = document.getElementById('brandChart');
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, 360);
    gradient.addColorStop(0, '#38ff88');
    gradient.addColorStop(1, '#0f3d2e');

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Sales',
          data: sales,
          backgroundColor: gradient,
          borderColor: 'rgba(56,255,136,0.45)',
          borderWidth: 1,
          borderRadius: 14,
          borderSkipped: false,
          barThickness: 42
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1400, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(5,5,5,0.92)',
            borderColor: 'rgba(56,255,136,0.28)',
            borderWidth: 1,
            padding: 14,
            titleColor: '#ffffff',
            bodyColor: '#d1fae5',
            callbacks: {
              label: (item) => `Sales: PHP ${Number(item.raw).toLocaleString()}`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: 'rgba(255,255,255,0.62)', font: { weight: 700 } },
            grid: { display: false }
          },
          y: {
            ticks: {
              color: 'rgba(255,255,255,0.48)',
              callback: (value) => `PHP ${Number(value) / 1000}k`
            },
            grid: { color: 'rgba(255,255,255,0.08)' }
          }
        }
      }
    });
  </script>
</body>
</html>
